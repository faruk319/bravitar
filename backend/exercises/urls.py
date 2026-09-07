from django.urls import path

from . import views

urlpatterns = [
    path("", views.ExerciseListCreateView.as_view(), name="exercise-list-create"),
    path("meta/", views.exercise_meta, name="exercise-meta"),
    path("<int:pk>/", views.ExerciseDetailView.as_view(), name="exercise-detail"),
]
