from django.urls import path

from . import views

urlpatterns = [
    path("pools/", views.PoolListCreateView.as_view(), name="pool-list-create"),
    path("lanes/", views.LaneBookingListCreateView.as_view(), name="lane-list-create"),
    path("lanes/<int:pk>/", views.LaneBookingDetailView.as_view(), name="lane-detail"),
    path("levels/", views.SwimLevelListCreateView.as_view(), name="swim-level-list-create"),
    path("assessments/", views.SkillAssessmentListCreateView.as_view(), name="assessment-list-create"),
    path("assessments/<int:pk>/", views.SkillAssessmentDetailView.as_view(), name="assessment-detail"),
    path("progress/", views.swimmer_progress, name="swimmer-progress"),
]
