from django.urls import path

from . import views

urlpatterns = [
    path("meta/", views.nutrition_meta, name="nutrition-meta"),
    path("foods/", views.FoodListCreateView.as_view(), name="food-list-create"),
    path("plan/", views.NutritionPlanView.as_view(), name="nutrition-plan"),
    path("log/", views.FoodLogListCreateView.as_view(), name="food-log-list-create"),
    path("log/<int:pk>/", views.FoodLogDetailView.as_view(), name="food-log-detail"),
    path("summary/", views.daily_summary, name="nutrition-summary"),
]
