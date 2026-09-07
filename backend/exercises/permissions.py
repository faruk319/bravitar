from organizations.constants import Vertical
from tenants.permissions import RequiresVertical


class HasFitnessVertical(RequiresVertical):
    """Gates the training side: exercises, workouts, nutrition, body log.

    Separate from the gym vertical on purpose — a swimming academy can track
    its swimmers' dry-land training without running a gym, and a gym can run
    memberships and check-ins without anyone logging a workout.
    """

    vertical = Vertical.FITNESS


class HasGymVertical(RequiresVertical):
    """Gates the gym business: memberships, check-ins, classes, trainers."""

    vertical = Vertical.GYM
