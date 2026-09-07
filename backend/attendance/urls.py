from django.urls import path

from . import views

urlpatterns = [
    path("", views.AttendanceListView.as_view(), name="attendance-list"),
    path("mark/", views.mark_register, name="attendance-mark"),
    path("summary/", views.attendance_summary, name="attendance-summary"),
]
