from organizations.constants import Vertical
from tenants.permissions import RequiresVertical


class HasGymVertical(RequiresVertical):
    """The gym plugin's endpoints are only reachable by organizations that
    selected the gym vertical."""

    vertical = Vertical.GYM
