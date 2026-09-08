"""API keys: creation, the one-time secret, and revocation.

A key that can't be revoked is the real hazard here — the whole point of
issuing one is being able to take it back when it leaks.
"""

from organizations.models import APIKey

from .base import TenantAPITestCase


class APIKeyTests(TenantAPITestCase):
    def create(self, name="my app", actor=None):
        return self.client_for(actor or self.owner).post(
            "/api/organizations/current/api-keys/", {"name": name}, format="json"
        )

    def test_the_raw_key_is_returned_once_and_never_stored(self):
        response = self.create()
        self.assertEqual(response.status_code, 201)
        raw = response.data["key"]

        stored = APIKey.objects.get(academy=self.org)
        self.assertNotEqual(stored.hashed_key, raw)
        self.assertTrue(raw.startswith(stored.prefix))

        # Listing again must not hand the secret back.
        listed = self.client_for(self.owner).get("/api/organizations/current/api-keys/")
        self.assertNotIn("key", listed.data["results"][0])

    def test_a_new_key_authenticates_requests(self):
        raw = self.create().data["key"]
        client = self.client_for(self.owner)
        response = client.get("/api/organizations/current/", HTTP_X_API_KEY=raw)
        self.assertEqual(response.status_code, 200)

    def test_revoking_stops_the_key_working(self):
        created = self.create()
        raw = created.data["key"]

        revoke = self.client_for(self.owner).post(
            f"/api/organizations/current/api-keys/{created.data['id']}/revoke/"
        )
        self.assertEqual(revoke.status_code, 200)
        self.assertFalse(revoke.data["is_active"])

        client = self.client_for(self.owner)
        response = client.get("/api/organizations/current/", HTTP_X_API_KEY=raw)
        self.assertEqual(response.status_code, 403)

    def test_revoking_is_one_way(self):
        """A key is revoked because it leaked; re-enabling it would undo
        exactly what revoking was for."""
        created = self.create()
        path = f"/api/organizations/current/api-keys/{created.data['id']}/revoke/"

        self.assertEqual(self.client_for(self.owner).post(path).status_code, 200)
        again = self.client_for(self.owner).post(path)
        self.assertEqual(again.status_code, 400)

        # And there is no route back to active.
        patched = self.client_for(self.owner).patch(
            "/api/organizations/current/api-keys/", {"is_active": True}, format="json"
        )
        self.assertIn(patched.status_code, (403, 405))
        self.assertFalse(APIKey.objects.get(pk=created.data["id"]).is_active)

    def test_a_revoked_key_stays_on_the_record(self):
        created = self.create()
        self.client_for(self.owner).post(
            f"/api/organizations/current/api-keys/{created.data['id']}/revoke/"
        )
        listed = self.client_for(self.owner).get("/api/organizations/current/api-keys/")
        self.assertEqual(listed.data["count"], 1)
        self.assertFalse(listed.data["results"][0]["is_active"])

    def test_only_an_owner_manages_keys(self):
        for actor, label in [(self.manager, "manager"), (self.staff, "staff")]:
            with self.subTest(role=label):
                self.assertEqual(
                    self.client_for(actor).get(
                        "/api/organizations/current/api-keys/"
                    ).status_code, 403,
                )
                self.assertEqual(self.create(actor=actor).status_code, 403)

    def test_another_organization_cannot_revoke_this_ones_key(self):
        created = self.create()
        response = self.client_for(self.other_owner, self.other_org).post(
            f"/api/organizations/current/api-keys/{created.data['id']}/revoke/"
        )
        self.assertEqual(response.status_code, 404)
        self.assertTrue(APIKey.objects.get(pk=created.data["id"]).is_active)

    def test_a_key_scopes_requests_to_its_own_organization(self):
        """The key decides the tenant, so it must not become a way to read
        someone else's academy by pointing it at their subdomain."""
        raw = self.create().data["key"]
        client = self.client_for(self.other_owner, self.other_org)
        response = client.get("/api/organizations/current/", HTTP_X_API_KEY=raw)
        self.assertEqual(response.status_code, 403)


class APIKeyAccessTests(TenantAPITestCase):
    """What a key may actually do once it authenticates.

    A key acts for the academy, not for a person. It runs the academy; it
    doesn't administer it, and it can't reach anything belonging to an
    individual.
    """

    def setUp(self):
        super().setUp()
        _, self.raw_key = APIKey.generate(self.org, name="their app")
        self.client = self.client_for(None)   # no session — only the key

    def get(self, path):
        return self.client.get(path, HTTP_X_API_KEY=self.raw_key)

    def post(self, path, payload):
        return self.client.post(path, payload, format="json", HTTP_X_API_KEY=self.raw_key)

    def test_a_key_alone_authenticates(self):
        """The point of the feature: someone else's app talks to us with just
        a key, no Supabase session at all."""
        response = self.get("/api/students/")
        self.assertEqual(response.status_code, 200)

    def test_a_key_can_run_the_academy(self):
        created = self.post(
            "/api/students/", {"full_name": "Signed up via API", "joined_on": "2026-01-01"}
        )
        self.assertEqual(created.status_code, 201)
        self.assertEqual(self.get("/api/batches/").status_code, 200)
        self.assertEqual(self.get("/api/billing/summary/").status_code, 200)

    def test_a_key_cannot_administer_the_academy(self):
        """A leaked key must not be able to hand out access or mint more keys
        — that would make revoking the one you know about pointless."""
        for path in ["/api/organizations/current/team/",
                     "/api/organizations/current/api-keys/"]:
            with self.subTest(path=path):
                self.assertEqual(self.get(path).status_code, 403)

        self.assertEqual(
            self.client.patch(
                "/api/organizations/current/", {"name": "Taken over"},
                format="json", HTTP_X_API_KEY=self.raw_key,
            ).status_code, 403,
        )
        self.org.refresh_from_db()
        self.assertEqual(self.org.name, "Iron Temple")

    def test_a_key_cannot_reach_anyones_personal_data(self):
        """Body logs, workouts and food diaries belong to a person. A key has
        none, so letting it in would mean rows attributed to nobody."""
        for path in ["/api/gym/body/entries/", "/api/gym/body/photos/",
                     "/api/gym/routines/", "/api/gym/nutrition/log/",
                     "/api/gym/stats/muscles/"]:
            with self.subTest(path=path):
                response = self.get(path)
                self.assertEqual(response.status_code, 403)
                self.assertIn("signed-in person", str(response.data["detail"]))

    def test_a_key_still_reads_shared_gym_data(self):
        """The exercise library belongs to the academy, not to a person."""
        self.assertEqual(self.get("/api/gym/exercises/").status_code, 200)

    def test_an_invalid_key_is_rejected_outright(self):
        response = self.client.get("/api/students/", HTTP_X_API_KEY="bvt_not_a_real_key")
        self.assertEqual(response.status_code, 403)
        self.assertIn("Invalid or revoked", str(response.data["detail"]))

    def test_a_revoked_key_stops_authenticating(self):
        APIKey.objects.filter(academy=self.org).update(is_active=False)
        response = self.get("/api/students/")
        self.assertEqual(response.status_code, 403)

    def test_a_key_records_when_it_was_last_used(self):
        self.assertIsNone(APIKey.objects.get(academy=self.org).last_used_at)
        self.get("/api/students/")
        self.assertIsNotNone(APIKey.objects.get(academy=self.org).last_used_at)

    def test_a_key_answers_for_its_own_academy_whatever_host_is_used(self):
        """Tenant resolution puts the key ahead of the Host header, so aiming
        a key at someone else's subdomain doesn't reach their data — it just
        keeps answering for the key's own academy."""
        from students.models import Student

        Student.objects.create(
            academy=self.org, full_name="Ours", joined_on="2026-01-01"
        )
        Student.objects.create(
            academy=self.other_org, full_name="Theirs", joined_on="2026-01-01"
        )

        aimed_elsewhere = self.client_for(None, self.other_org)
        response = aimed_elsewhere.get("/api/students/", HTTP_X_API_KEY=self.raw_key)

        self.assertEqual(response.status_code, 200)
        names = [row["full_name"] for row in response.data["results"]]
        self.assertEqual(names, ["Ours"], "a key must never surface another academy's data")
