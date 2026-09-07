from django.urls import path

from . import views

urlpatterns = [
    path("signup/", views.OrganizationSignupView.as_view(), name="organization-signup"),
    path("mine/", views.MyOrganizationsView.as_view(), name="my-organizations"),
    path("current/", views.CurrentOrganizationView.as_view(), name="current-organization"),
    path("current/team/", views.TeamListCreateView.as_view(), name="team-list-create"),
    path("current/team/<int:pk>/", views.TeamMemberDetailView.as_view(), name="team-member-detail"),
    path("current/branches/", views.BranchListCreateView.as_view(), name="branch-list-create"),
    path("current/branches/<int:pk>/", views.BranchDetailView.as_view(), name="branch-detail"),
    path("current/api-keys/", views.APIKeyListCreateView.as_view(), name="api-key-list-create"),
    path(
        "current/api-keys/<int:pk>/revoke/",
        views.APIKeyRevokeView.as_view(),
        name="api-key-revoke",
    ),
]
