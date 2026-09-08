from django.apps import AppConfig


class SubscriptionsConfig(AppConfig):
    name = "subscriptions"

    def ready(self):
        """Plug the membership rule into the core door. Plugin reaches into
        core, never the reverse."""
        from attendance.admission import register_rule
        from organizations.constants import Vertical

        from .admission import membership_admission

        register_rule(Vertical.GYM, membership_admission)
