from django.urls import path

from . import views

urlpatterns = [
    path("", views.CheckInListCreateView.as_view(), name="checkin-list-create"),
    path("scan/", views.scan, name="checkin-scan"),
    path("today/", views.today, name="checkin-today"),
    path("admission/<int:pk>/", views.admission, name="checkin-admission"),
    path("pass/<int:pk>/", views.MemberPassView.as_view(), name="member-pass"),
    path("pass/<int:pk>/qr.png", views.MemberPassImageView.as_view(), name="member-pass-image"),
    path("<int:pk>/", views.CheckInDetailView.as_view(), name="checkin-detail"),
    path("<int:pk>/out/", views.check_out, name="checkin-out"),
]
