from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from students.models import Student
from tenants.context import get_current_organization
from tenants.mixins import OrganizationScopedMixin
from tenants.permissions import IsOrganizationStaff

from .models import LaneBooking, Pool, SkillAssessment, SwimLevel
from .permissions import HasSwimmingVertical
from .serializers import (
    LaneBookingSerializer,
    PoolSerializer,
    SkillAssessmentSerializer,
    SwimLevelSerializer,
)


class SwimmingScopedMixin(OrganizationScopedMixin):
    permission_classes = [HasSwimmingVertical]

    def get_permissions(self):
        if self.request.method not in ("GET", "HEAD", "OPTIONS"):
            return [HasSwimmingVertical(), IsOrganizationStaff()]
        return [HasSwimmingVertical()]


class PoolListCreateView(SwimmingScopedMixin, generics.ListCreateAPIView):
    serializer_class = PoolSerializer

    def get_queryset(self):
        return self.scoped(Pool).select_related("branch")


class LaneBookingListCreateView(SwimmingScopedMixin, generics.ListCreateAPIView):
    serializer_class = LaneBookingSerializer

    def get_queryset(self):
        queryset = self.scoped(LaneBooking).select_related("pool", "batch")
        if pool := self.request.query_params.get("pool"):
            queryset = queryset.filter(pool_id=pool)
        return queryset


class LaneBookingDetailView(SwimmingScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = LaneBookingSerializer

    def get_queryset(self):
        return self.scoped(LaneBooking).select_related("pool", "batch")


class SwimLevelListCreateView(SwimmingScopedMixin, generics.ListCreateAPIView):
    serializer_class = SwimLevelSerializer

    def get_queryset(self):
        return self.scoped(SwimLevel).prefetch_related("skills")


class SkillAssessmentListCreateView(SwimmingScopedMixin, generics.ListCreateAPIView):
    serializer_class = SkillAssessmentSerializer

    def get_queryset(self):
        queryset = SkillAssessment.objects.filter(
            skill__level__academy=self.academy
        ).select_related("student", "skill")
        if student := self.request.query_params.get("student"):
            queryset = queryset.filter(student_id=student)
        return queryset

    def perform_create(self, serializer):
        # No academy column of its own — scope comes from the skill's
        # level and the student, both already validated.
        serializer.save(assessed_by=self.request.user.id)


class SkillAssessmentDetailView(SwimmingScopedMixin, generics.RetrieveDestroyAPIView):
    serializer_class = SkillAssessmentSerializer

    def get_queryset(self):
        return SkillAssessment.objects.filter(skill__level__academy=self.academy)


@api_view(["GET"])
@permission_classes([HasSwimmingVertical])
def swimmer_progress(request):
    """Every swimmer's position on the ladder.

    A level counts as reached only when every skill in it is signed off, so
    partial progress never reads as a completed level.
    """
    academy = get_current_organization(request)

    levels = list(
        SwimLevel.objects.filter(academy=academy).prefetch_related("skills")
    )
    skills_by_level = {level.id: [s.id for s in level.skills.all()] for level in levels}

    achieved = {}
    for assessment in SkillAssessment.objects.filter(
        skill__level__academy=academy
    ).select_related("student"):
        achieved.setdefault(assessment.student_id, set()).add(assessment.skill_id)

    students = Student.objects.filter(academy=academy)
    if student_id := request.query_params.get("student"):
        students = students.filter(pk=student_id)

    rows = []
    for student in students:
        done = achieved.get(student.id, set())
        if not done and request.query_params.get("only_active") == "true":
            continue

        current = None
        per_level = []
        for level in levels:
            skill_ids = skills_by_level[level.id]
            hit = len(done.intersection(skill_ids))
            complete = bool(skill_ids) and hit == len(skill_ids)
            if complete:
                current = level.name
            per_level.append({
                "level": level.id, "level_name": level.name,
                "achieved": hit, "total": len(skill_ids), "complete": complete,
            })

        rows.append({
            "student": student.id,
            "student_name": student.full_name,
            "current_level": current,
            "skills_achieved": len(done),
            "levels": per_level,
        })

    rows.sort(key=lambda r: (-r["skills_achieved"], r["student_name"]))
    return Response({"levels": [{"id": l.id, "name": l.name} for l in levels], "students": rows})
