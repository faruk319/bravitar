from django.urls import path

from . import views

urlpatterns = [
    path("tiers/", views.TierListCreateView.as_view(), name="tier-list-create"),
    path("tiers/<int:pk>/", views.TierDetailView.as_view(), name="tier-detail"),
    path("subscriptions/", views.SubscriptionListCreateView.as_view(), name="subscription-list-create"),
    path("subscriptions/<int:pk>/", views.SubscriptionDetailView.as_view(), name="subscription-detail"),
    path("expiring/", views.expiring_soon, name="memberships-expiring"),
    path("overview/", views.membership_overview, name="memberships-overview"),
    path("trainers/", views.TrainerAssignmentListCreateView.as_view(), name="trainer-list-create"),
    path("trainers/<int:pk>/", views.TrainerAssignmentDetailView.as_view(), name="trainer-detail"),
    path("trainers/earnings/", views.trainer_earnings, name="trainer-earnings"),
]
