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
