from organizations.constants import Vertical
from tenants.permissions import RequiresVertical


class HasKarateVertical(RequiresVertical):
    vertical = Vertical.KARATE
