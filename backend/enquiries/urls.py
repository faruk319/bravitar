from django.urls import path

from . import views

urlpatterns = [
    path("", views.EnquiryListCreateView.as_view(), name="enquiry-list-create"),
    path("funnel/", views.enquiry_funnel, name="enquiry-funnel"),
    path("<int:pk>/", views.EnquiryDetailView.as_view(), name="enquiry-detail"),
    path("<int:pk>/convert/", views.convert_enquiry, name="enquiry-convert"),
]
