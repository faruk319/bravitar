"""Vertical-plugin domain rules that are easy to get subtly wrong."""

from datetime import date
from decimal import Decimal

from karate.constants import GradingResultChoice
from karate.models import Belt, Bout, Grading, GradingResult
from students.models import Student
from swimming.models import Pool, SwimLevel, SwimSkill
from workouts.models import estimate_one_rep_max

from .base import TenantAPITestCase


class SwimmingTestCase(TenantAPITestCase):
    def setUp(self):
        super().setUp()
        self.org.verticals = ["gym", "swimming"]
        self.org.save()


class LaneBookingTests(SwimmingTestCase):
    """A lane cannot be in two places at once — a double-booked lane means two
    classes turning up to the same water."""

    def setUp(self):
        super().setUp()
        self.pool = Pool.objects.create(organization=self.org, name="Main", lane_count=6)

    def book(self, start, end, lane=1, day=1):
        return self.client_for(self.owner).post(
            "/api/swimming/lanes/",
            {"pool": self.pool.id, "lane_number": lane, "day_of_week": day,
             "start_time": start, "end_time": end},
            format="json",
        )

    def test_overlapping_booking_is_refused(self):
        self.assertEqual(self.book("10:00", "11:00").status_code, 201)
        self.assertEqual(self.book("10:30", "11:30").status_code, 400)

    def test_a_fully_contained_booking_is_refused(self):
        self.book("10:00", "11:00")
        self.assertEqual(self.book("10:15", "10:45").status_code, 400)

    def test_a_booking_starting_exactly_when_another_ends_is_allowed(self):
        self.book("10:00", "11:00")
        self.assertEqual(self.book("11:00", "12:00").status_code, 201)

    def test_the_same_time_on_another_lane_is_allowed(self):
        self.book("10:00", "11:00", lane=1)
        self.assertEqual(self.book("10:00", "11:00", lane=2).status_code, 201)

    def test_the_same_lane_on_another_day_is_allowed(self):
        self.book("10:00", "11:00", day=1)
        self.assertEqual(self.book("10:00", "11:00", day=2).status_code, 201)

    def test_a_lane_the_pool_does_not_have_is_refused(self):
        self.assertEqual(self.book("10:00", "11:00", lane=9).status_code, 400)

    def test_end_before_start_is_refused(self):
        self.assertEqual(self.book("11:00", "10:00").status_code, 400)


class SwimProgressTests(SwimmingTestCase):
    def test_a_level_needs_every_skill_before_it_counts(self):
        level = SwimLevel.objects.create(organization=self.org, name="Level 1", position=0)
        skills = [
            SwimSkill.objects.create(level=level, name=f"Skill {i}", position=i)
            for i in range(3)
        ]
        student = Student.objects.create(
            organization=self.org, full_name="Swimmer", joined_on=date(2026, 1, 1)
        )

        for skill in skills[:2]:
            self.client_for(self.owner).post(
                "/api/swimming/assessments/",
                {"student": student.id, "skill": skill.id, "achieved_on": "2026-01-01"},
                format="json",
            )

        row = self._progress_for(student)
        self.assertIsNone(row["current_level"], "2 of 3 skills must not complete a level")
        self.assertFalse(row["levels"][0]["complete"])
        self.assertEqual(row["levels"][0]["achieved"], 2)

        self.client_for(self.owner).post(
            "/api/swimming/assessments/",
            {"student": student.id, "skill": skills[2].id, "achieved_on": "2026-01-02"},
            format="json",
        )
        self.assertEqual(self._progress_for(student)["current_level"], "Level 1")

    def _progress_for(self, student):
        response = self.client_for(self.owner).get("/api/swimming/progress/")
        return next(r for r in response.data["students"] if r["student"] == student.id)


class BeltDerivationTests(TenantAPITestCase):
    """A belt is derived from gradings, never stored — correcting a result has
    to correct the belt, or the dojo's records disagree with its wall."""

    def setUp(self):
        super().setUp()
        self.org.verticals = ["karate"]
        self.org.save()
        self.white = Belt.objects.create(organization=self.org, name="White", position=0)
        self.green = Belt.objects.create(organization=self.org, name="Green", position=3)
        self.student = Student.objects.create(
            organization=self.org, full_name="Karateka", joined_on=date(2026, 1, 1)
        )

    def standing(self):
        response = self.client_for(self.owner).get("/api/karate/standings/")
        return next(
            (r for r in response.data["students"] if r["student"] == self.student.id), None
        )

    def grade(self, belt, result):
        grading = Grading.objects.create(
            organization=self.org, belt=belt, held_on=date(2026, 1, 1)
        )
        return GradingResult.objects.create(
            grading=grading, student=self.student, result=result
        )

    def test_a_failed_grading_does_not_award_the_belt(self):
        self.grade(self.green, GradingResultChoice.FAIL)
        self.assertIsNone(self.standing())

    def test_the_belt_is_the_highest_passed(self):
        self.grade(self.white, GradingResultChoice.PASS)
        self.grade(self.green, GradingResultChoice.PASS)
        self.assertEqual(self.standing()["belt"], "Green")

    def test_correcting_a_result_corrects_the_belt(self):
        self.grade(self.white, GradingResultChoice.PASS)
        result = self.grade(self.green, GradingResultChoice.PASS)
        self.assertEqual(self.standing()["belt"], "Green")

        result.result = GradingResultChoice.FAIL
        result.save()
        self.assertEqual(self.standing()["belt"], "White")

    def test_win_rate_matches_the_bouts(self):
        self.grade(self.white, GradingResultChoice.PASS)
        for result in ["win", "win", "loss", "draw"]:
            Bout.objects.create(
                organization=self.org, student=self.student,
                fought_on=date(2026, 1, 1), result=result,
            )
        row = self.standing()
        self.assertEqual((row["wins"], row["losses"], row["draws"]), (2, 1, 1))
        self.assertEqual(row["bouts"], 4)
        self.assertEqual(row["win_rate"], 0.5)


class OneRepMaxTests(TenantAPITestCase):
    def test_a_single_estimates_to_its_own_weight(self):
        self.assertAlmostEqual(
            float(estimate_one_rep_max(Decimal("100"), 1)), 103.33, places=2
        )

    def test_bodyweight_sets_have_no_estimate(self):
        self.assertIsNone(estimate_one_rep_max(None, 10))

    def test_more_reps_at_the_same_weight_estimates_higher(self):
        self.assertGreater(
            estimate_one_rep_max(Decimal("100"), 8),
            estimate_one_rep_max(Decimal("100"), 5),
        )


class PersonalRecordTests(TenantAPITestCase):
    """Warm-ups must not set records: a heavy warm-up single would otherwise
    fake a PR and then poison every progression suggestion after it."""

    def setUp(self):
        super().setUp()
        from exercises.models import Exercise

        self.exercise = Exercise.objects.create(
            name="Bench", slug="bench", primary_muscle="chest"
        )
        self.session = self.client_for(self.staff).post(
            "/api/gym/sessions/", {}, format="json"
        ).data

    def log(self, reps, weight, is_warmup=False):
        return self.client_for(self.staff).post(
            f"/api/gym/sessions/{self.session['id']}/sets/",
            {"exercise_id": self.exercise.id, "reps": reps, "weight": weight,
             "is_warmup": is_warmup},
            format="json",
        )

    def test_first_working_set_is_a_record(self):
        self.assertTrue(self.log(5, "60.00").data["is_personal_record"])

    def test_a_heavy_warmup_is_not_a_record(self):
        self.assertFalse(self.log(8, "100.00", is_warmup=True).data["is_personal_record"])

    def test_a_warmup_does_not_block_a_later_working_record(self):
        self.log(8, "100.00", is_warmup=True)
        self.assertTrue(self.log(5, "60.00").data["is_personal_record"])

    def test_repeating_the_same_set_is_not_a_second_record(self):
        self.log(5, "60.00")
        self.assertFalse(self.log(5, "60.00").data["is_personal_record"])

    def test_a_lighter_set_is_not_a_record(self):
        self.log(5, "60.00")
        self.assertFalse(self.log(5, "50.00").data["is_personal_record"])
