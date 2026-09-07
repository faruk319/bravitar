"""
Django settings for config project.

For more information on this file, see
https://docs.djangoproject.com/en/6.1/topics/settings/
"""

import os
from pathlib import Path

import dotenv
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

dotenv.load_dotenv(BASE_DIR / ".env")

INSECURE_DEV_SECRET_KEY = "django-insecure-kshmy#na_q8+k=)1h)*+7-3vm#%j&tplcss4y2hwprk&16&8&d"

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", INSECURE_DEV_SECRET_KEY)

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = os.environ.get("DJANGO_DEBUG", "True") == "True"

ALLOWED_HOSTS = [
    h.strip() for h in os.environ.get("DJANGO_ALLOWED_HOSTS", "").split(",") if h.strip()
]

# Refuse to boot insecurely rather than run and hope nobody notices. A
# deployment that forgets DJANGO_SECRET_KEY would otherwise sign sessions with
# a key that is public in this repository.
if not DEBUG:
    # Checking only for the literal repo default isn't enough — the likeliest
    # mistake is copying the placeholder out of .env.example, which is a
    # different string but just as public.
    _weak_markers = ("insecure", "dev-only", "change-me", "changeme", "secret-key")
    _key = SECRET_KEY.lower()
    if len(SECRET_KEY) < 40 or any(marker in _key for marker in _weak_markers):
        raise ImproperlyConfigured(
            "DJANGO_SECRET_KEY looks like a placeholder. Set a real random "
            "secret of at least 40 characters when DEBUG is off."
        )
    if not ALLOWED_HOSTS:
        raise ImproperlyConfigured("DJANGO_ALLOWED_HOSTS must be set when DEBUG is off.")

    SECURE_SSL_REDIRECT = os.environ.get("DJANGO_SECURE_SSL_REDIRECT", "True") == "True"
    SECURE_HSTS_SECONDS = int(os.environ.get("DJANGO_HSTS_SECONDS", 60 * 60 * 24 * 30))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = "DENY"


# Application definition

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "corsheaders",
    "accounts",
    "organizations",
    "tenants",
    "exercises",
    "workouts",
    "bodylog",
    "nutrition",
    # Cross-vertical core (Phase 4)
    "students",
    "batches",
    "attendance",
    "billing",
    "enquiries",
    # Vertical plugins (Phase 5)
    "swimming",
    "karate",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "tenants.middleware.TenantResolutionMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# Database
# https://docs.djangoproject.com/en/6.1/ref/settings/#databases
# Falls back to sqlite for local dev when Supabase env vars aren't set.

if os.environ.get("SUPABASE_DB_HOST"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "HOST": os.environ["SUPABASE_DB_HOST"],
            "PORT": os.environ.get("SUPABASE_DB_PORT", "5432"),
            "NAME": os.environ.get("SUPABASE_DB_NAME", "postgres"),
            "USER": os.environ.get("SUPABASE_DB_USER", "postgres"),
            "PASSWORD": os.environ.get("SUPABASE_DB_PASSWORD", ""),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }


# Password validation
# https://docs.djangoproject.com/en/6.1/ref/settings/#auth-password-validators

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


# Internationalization
# https://docs.djangoproject.com/en/6.1/topics/i18n/

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True


# Static files (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/6.1/howto/static-files/

STATIC_URL = "static/"

# Progress photos live here. Deliberately NOT wired to a static/media URL:
# they are private, and are only ever served through a view that checks
# the requester owns them. Production should move this to object storage.
MEDIA_ROOT = BASE_DIR / "media"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# Django REST Framework

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "accounts.authentication.SupabaseJWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_PAGINATION_CLASS": "config.pagination.StandardPagination",
    "PAGE_SIZE": 50,
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        # Anonymous traffic should only ever be hitting the health check and
        # being rejected by auth, so it is held short.
        "anon": os.environ.get("THROTTLE_ANON", "30/min"),
        "user": os.environ.get("THROTTLE_USER", "1000/hour"),
    },
}

# CORS. The dev server proxies /api same-origin, so this only matters for
# clients calling the API directly.
CORS_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.environ.get("CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000").split(",")
    if o.strip()
]

# Every academy gets its own subdomain, so listing literal origins would mean
# editing settings on every signup. Matches https://<slug>.<BASE_DOMAIN> only.
_base_domain = os.environ.get("DJANGO_BASE_DOMAIN", "")
CORS_ALLOWED_ORIGIN_REGEXES = (
    [r"^https://[a-z0-9-]+\.%s$" % _base_domain.replace(".", r"\.")] if _base_domain else []
)

CORS_ALLOW_CREDENTIALS = False

# Supabase Auth — used to verify JWTs issued by Supabase for signed-in users.
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_JWT_SECRET = os.environ.get("SUPABASE_JWT_SECRET", "")

# Tenant resolution: <org-slug>.<BASE_DOMAIN> routes to that Organization.
BASE_DOMAIN = os.environ.get("DJANGO_BASE_DOMAIN", "")
