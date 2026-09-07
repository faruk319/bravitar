"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('accounts.urls')),
    path('api/organizations/', include('organizations.urls')),
    # Gym/fitness vertical plugin
    path('api/gym/exercises/', include('exercises.urls')),
    path('api/gym/', include('workouts.urls')),
    path('api/gym/body/', include('bodylog.urls')),
    path('api/gym/nutrition/', include('nutrition.urls')),
    # Cross-vertical core — available to every vertical
    path('api/students/', include('students.urls')),
    path('api/batches/', include('batches.urls')),
    path('api/attendance/', include('attendance.urls')),
    path('api/billing/', include('billing.urls')),
    path('api/enquiries/', include('enquiries.urls')),
]
