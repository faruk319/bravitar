from django.apps import AppConfig


class SubscriptionsConfig(AppConfig):
    name = "subscriptions"

    def ready(self):
        """Plug the gym's rules into core: who the door admits, and how many
        classes a plan includes. Plugin reaches into core, never the reverse."""
        from attendance.admission import register_rule
        from batches.allowance import register_rule as register_allowance
        from organizations.constants import Vertical

        from .admission import membership_admission
        from .allowance import classes_per_week

        register_rule(Vertical.GYM, membership_admission)
        register_allowance(Vertical.GYM, classes_per_week)
