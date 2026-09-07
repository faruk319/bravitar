from django.urls import path

from . import views

urlpatterns = [
    path("signup/", views.OrganizationSignupView.as_view(), name="organization-signup"),
    path("mine/", views.MyOrganizationsView.as_view(), name="my-organizations"),
    path("current/", views.CurrentOrganizationView.as_view(), name="current-organization"),
    path("current/branches/", views.BranchListCreateView.as_view(), name="branch-list-create"),
    path("current/api-keys/", views.APIKeyListCreateView.as_view(), name="api-key-list-create"),
]
