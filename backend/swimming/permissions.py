from organizations.constants import Vertical
from tenants.permissions import RequiresVertical


class HasSwimmingVertical(RequiresVertical):
    vertical = Vertical.SWIMMING
