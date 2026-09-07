from rest_framework import generics

from tenants.mixins import OrganizationScopedMixin

from .models import Student
from .serializers import StudentSerializer


class StudentListCreateView(OrganizationScopedMixin, generics.ListCreateAPIView):
    serializer_class = StudentSerializer

    def get_queryset(self):
        queryset = self.scoped(Student).select_related("branch")
        params = self.request.query_params
        if search := params.get("search"):
            queryset = queryset.filter(full_name__icontains=search)
        if status_filter := params.get("status"):
            queryset = queryset.filter(status=status_filter)
        return queryset


class StudentDetailView(OrganizationScopedMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = StudentSerializer

    def get_queryset(self):
        return self.scoped(Student).select_related("branch")
