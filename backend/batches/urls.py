from django.urls import path

from . import views

urlpatterns = [
    path("", views.BatchListCreateView.as_view(), name="batch-list-create"),
    path("<int:pk>/", views.BatchDetailView.as_view(), name="batch-detail"),
    path("enrolments/", views.EnrolmentListCreateView.as_view(), name="enrolment-list-create"),
    path("enrolments/<int:pk>/", views.EnrolmentDetailView.as_view(), name="enrolment-detail"),
]
