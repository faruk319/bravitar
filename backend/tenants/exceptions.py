from rest_framework import status
from rest_framework.exceptions import APIException


class OrganizationNotFound(APIException):
    status_code = status.HTTP_404_NOT_FOUND
    default_detail = "No organization could be resolved for this request."
    default_code = "organization_not_found"
