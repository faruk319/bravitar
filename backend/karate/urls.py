from django.urls import path

from . import views

urlpatterns = [
    path("belts/", views.BeltListCreateView.as_view(), name="belt-list-create"),
    path("gradings/", views.GradingListCreateView.as_view(), name="grading-list-create"),
    path("gradings/<int:pk>/", views.GradingDetailView.as_view(), name="grading-detail"),
    path("results/", views.GradingResultListCreateView.as_view(), name="grading-result-list-create"),
    path("bouts/", views.BoutListCreateView.as_view(), name="bout-list-create"),
    path("bouts/<int:pk>/", views.BoutDetailView.as_view(), name="bout-detail"),
    path("standings/", views.belt_standings, name="belt-standings"),
]
