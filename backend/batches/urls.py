from django.urls import path

from . import views

urlpatterns = [
    path("", views.BatchListCreateView.as_view(), name="batch-list-create"),
    path("<int:pk>/", views.BatchDetailView.as_view(), name="batch-detail"),
    path("sessions/", views.sessions, name="session-list"),
    path("bookings/", views.BookingListCreateView.as_view(), name="booking-list-create"),
    path("bookings/<int:pk>/", views.BookingDetailView.as_view(), name="booking-detail"),
    path("bookings/<int:pk>/cancel/", views.cancel_booking, name="booking-cancel"),
    path("enrolments/", views.EnrolmentListCreateView.as_view(), name="enrolment-list-create"),
    path("enrolments/<int:pk>/", views.EnrolmentDetailView.as_view(), name="enrolment-detail"),
]
