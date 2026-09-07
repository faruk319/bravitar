from rest_framework import generics

from tenants.mixins import OrganizationScopedMixin

from .models import Batch, Enrolment
from .serializers import BatchSerializer, EnrolmentSerializer


class BatchListCreateView(OrganizationScopedMixin, generics.ListCreateAPIView):
    serializer_class = BatchSerializer

    def get_queryset(self):
        queryset = self.scoped(Batch).select_related("branch")
        if self.request.query_params.get("active") == "true":
            queryset = queryset.filter(is_active=True)
        return queryset


class BatchDetailView(OrganizationScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = BatchSerializer

    def get_queryset(self):
        return self.scoped(Batch).select_related("branch")


class EnrolmentListCreateView(OrganizationScopedMixin, generics.ListCreateAPIView):
    serializer_class = EnrolmentSerializer

    def get_queryset(self):
        queryset = Enrolment.objects.filter(
            batch__organization=self.organization
        ).select_related("student", "batch")
        params = self.request.query_params
        if batch := params.get("batch"):
            queryset = queryset.filter(batch_id=batch)
        if student := params.get("student"):
            queryset = queryset.filter(student_id=student)
        return queryset

    def perform_create(self, serializer):
        # Enrolment has no organization column of its own — it inherits scope
        # from the batch, which the serializer has already validated.
        serializer.save()


class EnrolmentDetailView(OrganizationScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = EnrolmentSerializer

    def get_queryset(self):
        return Enrolment.objects.filter(
            batch__organization=self.organization
        ).select_related("student", "batch")
