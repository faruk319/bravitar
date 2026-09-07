from django.urls import path

from . import views

urlpatterns = [
    path("meta/", views.bodylog_meta, name="bodylog-meta"),
    path("entries/", views.MeasurementListCreateView.as_view(), name="measurement-list-create"),
    path("entries/<int:pk>/", views.MeasurementDetailView.as_view(), name="measurement-detail"),
    path("photos/", views.ProgressPhotoListCreateView.as_view(), name="photo-list-create"),
    path("photos/<int:pk>/", views.ProgressPhotoDetailView.as_view(), name="photo-detail"),
    path("photos/<int:pk>/image/", views.ProgressPhotoImageView.as_view(), name="photo-image"),
]
