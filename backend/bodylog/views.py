from django.http import FileResponse, Http404
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from exercises.permissions import HasFitnessVertical
from students.owner import own_student
from tenants.context import get_current_academy
from tenants.permissions import IsPerson

from .constants import Metric, Pose, Unit
from .models import MeasurementEntry, ProgressPhoto
from .serializers import MeasurementEntrySerializer, ProgressPhotoSerializer


class BodyLogScopedMixin:
    """Body data is private to the member it belongs to — a trainer does not
    see it implicitly. Every queryset is filtered to the caller."""

    permission_classes = [HasFitnessVertical, IsPerson]

    @property
    def academy(self):
        return get_current_academy(self.request)

    @property
    def member(self):
        """Deliberately their own, unlike routines and macro targets. Those
        are a plan somebody writes for you; this is a picture of your body."""
        return own_student(self.request, self.academy, required=False)

    def base_queryset(self, model):
        # No record here means no body data here — an empty list, not a 404.
        # Filtering on a null student would match everybody else's rows.
        member = self.member
        if member is None:
            return model.objects.none()
        return model.objects.filter(academy=self.academy, student=member)

    def perform_create(self, serializer):
        serializer.save(
            academy=self.academy,
            student=own_student(self.request, self.academy),
        )


class MeasurementListCreateView(BodyLogScopedMixin, generics.ListCreateAPIView):
    serializer_class = MeasurementEntrySerializer

    def get_queryset(self):
        queryset = self.base_queryset(MeasurementEntry)
        if metric := self.request.query_params.get("metric"):
            queryset = queryset.filter(metric=metric)
        return queryset.order_by("measured_on")

    def create(self, request, *args, **kwargs):
        """Re-measuring the same metric on the same day overwrites that day's
        reading rather than failing on the uniqueness constraint."""
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        existing = self.base_queryset(MeasurementEntry).filter(
            metric=serializer.validated_data["metric"],
            measured_on=serializer.validated_data["measured_on"],
        ).first()

        if existing:
            serializer = self.get_serializer(existing, data=request.data)
            serializer.is_valid(raise_exception=True)
            serializer.save()
            return Response(serializer.data, status=status.HTTP_200_OK)

        self.perform_create(serializer)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class MeasurementDetailView(BodyLogScopedMixin, generics.RetrieveDestroyAPIView):
    serializer_class = MeasurementEntrySerializer

    def get_queryset(self):
        return self.base_queryset(MeasurementEntry)


class ProgressPhotoListCreateView(BodyLogScopedMixin, generics.ListCreateAPIView):
    serializer_class = ProgressPhotoSerializer
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        return self.base_queryset(ProgressPhoto)


class ProgressPhotoDetailView(BodyLogScopedMixin, generics.RetrieveDestroyAPIView):
    serializer_class = ProgressPhotoSerializer

    def get_queryset(self):
        return self.base_queryset(ProgressPhoto)


class ProgressPhotoImageView(BodyLogScopedMixin, generics.GenericAPIView):
    """Streams the actual file. This is the only way to read a progress
    photo — the files are never exposed through static file serving."""

    serializer_class = ProgressPhotoSerializer

    def get(self, request, pk):
        photo = self.base_queryset(ProgressPhoto).filter(pk=pk).first()
        if photo is None:
            raise Http404
        return FileResponse(photo.image.open("rb"))


@api_view(["GET"])
@permission_classes([HasFitnessVertical])
def bodylog_meta(request):
    return Response(
        {
            "metrics": [
                {
                    "value": value,
                    "label": label,
                    "units": Metric.allowed_units(value),
                    "default_unit": Metric.default_unit(value),
                }
                for value, label in Metric.CHOICES
            ],
            "units": [{"value": v, "label": label} for v, label in Unit.CHOICES],
            "poses": [{"value": v, "label": label} for v, label in Pose.CHOICES],
        }
    )
