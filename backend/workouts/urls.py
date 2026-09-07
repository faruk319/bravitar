from django.urls import path

from . import views

urlpatterns = [
    path("routines/", views.RoutineListCreateView.as_view(), name="routine-list-create"),
    path("routines/<int:pk>/", views.RoutineDetailView.as_view(), name="routine-detail"),
    path("sessions/", views.WorkoutSessionListCreateView.as_view(), name="session-list-create"),
    path("sessions/<int:pk>/", views.WorkoutSessionDetailView.as_view(), name="session-detail"),
    path(
        "sessions/<int:pk>/complete/",
        views.WorkoutSessionCompleteView.as_view(),
        name="session-complete",
    ),
    path(
        "sessions/<int:session_id>/sets/",
        views.SetLogCreateView.as_view(),
        name="set-log-create",
    ),
]
