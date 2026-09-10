from django.urls import path

from . import me

urlpatterns = [
    path("", me.whoami, name="me-whoami"),
    path("<int:pk>/", me.my_details, name="me-details"),
    path("<int:pk>/overview/", me.my_overview, name="me-overview"),
    path("<int:pk>/sessions/", me.my_sessions, name="me-sessions"),
    path("<int:pk>/bookings/", me.my_booking, name="me-booking"),
    path("<int:pk>/attendance/", me.my_attendance, name="me-attendance"),
    path("<int:pk>/invoices/", me.my_invoices, name="me-invoices"),
]
