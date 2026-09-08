"""Pagination correctness.

Two things matter: the shape callers depend on, and that walking every page
returns each row exactly once. Without a deterministic total order, rows can
appear on two pages or on none at all.
"""

from datetime import date

from students.models import Student

from .base import TenantAPITestCase


class PaginationShapeTests(TenantAPITestCase):
    def setUp(self):
        super().setUp()
        Student.objects.bulk_create([
            Student(organization=self.org, full_name=f"Student {i:03}",
                    joined_on=date(2026, 1, 1))
            for i in range(210)
        ])

    def test_list_is_wrapped_with_count_and_next(self):
        response = self.client_for(self.owner).get("/api/students/")
        self.assertEqual(
            sorted(response.data.keys()), ["count", "next", "previous", "results"]
        )
        self.assertEqual(response.data["count"], 210)
        self.assertEqual(len(response.data["results"]), 50)
        self.assertIsNotNone(response.data["next"])

    def test_page_size_is_capped(self):
        """A caller asking for everything must not be able to make the server
        materialise an unbounded result set."""
        response = self.client_for(self.owner).get("/api/students/?page_size=99999")
        self.assertEqual(response.data["count"], 210)
        self.assertEqual(len(response.data["results"]), 200)

    def test_walking_every_page_returns_each_row_exactly_once(self):
        seen, path = [], "/api/students/?page_size=25"
        while path:
            response = self.client_for(self.owner).get(path)
            seen.extend(row["id"] for row in response.data["results"])
            next_url = response.data["next"]
            path = next_url[next_url.index("/api/"):] if next_url else None

        self.assertEqual(len(seen), 210)
        self.assertEqual(len(set(seen)), 210, "a row appeared on two pages")

    def test_pagination_respects_the_tenant_filter(self):
        Student.objects.create(
            organization=self.other_org, full_name="Theirs", joined_on=date(2026, 1, 1)
        )
        response = self.client_for(self.owner).get("/api/students/")
        self.assertEqual(response.data["count"], 210)

    def test_filters_apply_before_paging(self):
        response = self.client_for(self.owner).get("/api/students/?search=Student 001")
        self.assertEqual(response.data["count"], 1)


class MembershipStatusPaginationTests(TenantAPITestCase):
    """A status filter that annotates has to stay ordered.

    Django drops a model's default ordering when you add an aggregate, and an
    unordered queryset lets the paginator hand back the same row on two pages
    while another row is never shown at all.
    """

    def test_filtering_by_a_derived_status_stays_ordered(self):
        from subscriptions.models import MemberSubscription

        self.org.verticals = ["gym"]
        self.org.save()
        for status in ("pending", "active", "expired", "cancelled"):
            queryset = MemberSubscription.objects.filter(
                organization=self.org
            ).by_status(status, self.org)
            self.assertTrue(
                queryset.ordered,
                f"status={status} returns an unordered queryset, so paging it drops rows",
            )


class MemberListPaginationTests(TenantAPITestCase):
    """Counting each member's documents must not cost their ordering.

    Goes through HTTP rather than poking the view, because the defect only
    shows up once the paginator is the thing consuming the queryset.
    """

    def test_paging_the_member_list_shows_every_member_once(self):
        from datetime import date

        from students.models import Student

        names = [f"Member {i:02d}" for i in range(25)]
        for name in names:
            Student.objects.create(
                organization=self.org, full_name=name, joined_on=date(2026, 1, 1)
            )

        seen = []
        url = "/api/students/?page_size=10"
        client = self.client_for(self.manager)
        while url:
            response = client.get(url)
            self.assertEqual(response.status_code, 200)
            seen.extend(row["full_name"] for row in response.data["results"])
            following = response.data.get("next")
            url = following[following.index("/api/"):] if following else None

        self.assertEqual(len(seen), len(set(seen)), "a member was returned on two pages")
        self.assertEqual(sorted(seen), sorted(names))
