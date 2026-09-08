from django.urls import path

from . import views

urlpatterns = [
    # The register a coach marks.
    path("", views.AttendanceListView.as_view(), name="attendance-list"),
    path("mark/", views.mark_register, name="attendance-mark"),
    path("summary/", views.attendance_summary, name="attendance-summary"),

    # The door. Core, not a plugin — every academy has one, and what decides
    # who comes in is registered per vertical in admission.py.
    path("checkins/", views.CheckInListCreateView.as_view(), name="checkin-list-create"),
    path("checkins/scan/", views.scan, name="checkin-scan"),
    path("checkins/today/", views.today, name="checkin-today"),
    path("checkins/admission/<int:pk>/", views.admission, name="checkin-admission"),
    path("checkins/pass/<int:pk>/", views.MemberPassView.as_view(), name="member-pass"),
    path(
        "checkins/pass/<int:pk>/qr.png",
        views.MemberPassImageView.as_view(),
        name="member-pass-image",
    ),
    path("checkins/<int:pk>/", views.CheckInDetailView.as_view(), name="checkin-detail"),
    path("checkins/<int:pk>/out/", views.check_out, name="checkin-out"),
]
