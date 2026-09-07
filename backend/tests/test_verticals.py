"""Vertical gating — what makes the plugin system real rather than a UI filter.

A gym-only academy must be refused by the swimming and karate APIs even
though the endpoints exist and it is a perfectly valid organization.
"""

from .base import TenantAPITestCase

FITNESS_ENDPOINTS = ["/api/gym/exercises/", "/api/gym/routines/", "/api/gym/stats/muscles/"]
GYM_OPS_ENDPOINTS = ["/api/gym-ops/tiers/", "/api/gym-ops/overview/"]
SWIM_ENDPOINTS = ["/api/swimming/pools/", "/api/swimming/levels/", "/api/swimming/progress/"]
KARATE_ENDPOINTS = ["/api/karate/belts/", "/api/karate/bouts/", "/api/karate/standings/"]


class VerticalGatingTests(TenantAPITestCase):
    def test_a_gym_reaches_both_of_its_verticals(self):
        for path in FITNESS_ENDPOINTS + GYM_OPS_ENDPOINTS:
            with self.subTest(path=path):
                self.assertEqual(self.client_for(self.owner).get(path).status_code, 200)

    def test_a_gym_is_refused_by_other_verticals(self):
        for path in SWIM_ENDPOINTS + KARATE_ENDPOINTS:
            with self.subTest(path=path):
                response = self.client_for(self.owner).get(path)
                self.assertEqual(response.status_code, 403)
                self.assertIn("module enabled", str(response.data["detail"]))

    def test_swim_academy_reaches_swimming_but_not_fitness(self):
        for path in SWIM_ENDPOINTS:
            with self.subTest(path=path):
                client = self.client_for(self.other_owner, self.other_org)
                self.assertEqual(client.get(path).status_code, 200)

        for path in FITNESS_ENDPOINTS:
            with self.subTest(path=path):
                client = self.client_for(self.other_owner, self.other_org)
                self.assertEqual(client.get(path).status_code, 403)

    def test_gating_also_blocks_writes(self):
        response = self.client_for(self.owner).post(
            "/api/karate/belts/", {"name": "White", "position": 0}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_enabling_a_vertical_opens_its_api(self):
        self.assertEqual(self.client_for(self.owner).get("/api/karate/belts/").status_code, 403)

        self.client_for(self.owner).patch(
            "/api/organizations/current/", {"verticals": ["gym", "karate"]}, format="json"
        )
        self.assertEqual(self.client_for(self.owner).get("/api/karate/belts/").status_code, 200)

    def test_disabling_a_vertical_closes_its_api_without_deleting_data(self):
        self.client_for(self.owner).patch(
            "/api/organizations/current/", {"verticals": ["gym", "karate"]}, format="json"
        )
        self.client_for(self.owner).post(
            "/api/karate/belts/", {"name": "White", "position": 0}, format="json"
        )

        self.client_for(self.owner).patch(
            "/api/organizations/current/", {"verticals": ["gym"]}, format="json"
        )
        self.assertEqual(self.client_for(self.owner).get("/api/karate/belts/").status_code, 403)

        # Switching it back on must find the belt still there.
        self.client_for(self.owner).patch(
            "/api/organizations/current/", {"verticals": ["gym", "karate"]}, format="json"
        )
        response = self.client_for(self.owner).get("/api/karate/belts/")
        self.assertEqual(response.data["count"], 1)
