from django.urls import path

from . import views

urlpatterns = [
    path("", views.StudentListCreateView.as_view(), name="student-list-create"),
    path("meta/", views.onboarding_meta, name="onboarding-meta"),
    path(
        "documents/",
        views.MemberDocumentListCreateView.as_view(),
        name="member-document-list-create",
    ),
    path(
        "documents/<int:pk>/",
        views.MemberDocumentDetailView.as_view(),
        name="member-document-detail",
    ),
    path(
        "documents/<int:pk>/file/",
        views.MemberDocumentFileView.as_view(),
        name="member-document-file",
    ),
    path("documents/<int:pk>/verify/", views.verify_document, name="member-document-verify"),
    path("<int:pk>/", views.StudentDetailView.as_view(), name="student-detail"),
    path("<int:pk>/photo/", views.MemberPhotoView.as_view(), name="member-photo"),
]
