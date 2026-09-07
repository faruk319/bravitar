from rest_framework.pagination import PageNumberPagination


class StandardPagination(PageNumberPagination):
    """Page-number pagination for every list endpoint.

    Applied globally rather than per-view: a list that is small today (one
    academy's branches) is not necessarily small next year, and a silently
    truncated list is worse than a paged one.

    Callers that genuinely need every row — a dropdown, a chart series, a
    register to mark — ask for the next page until there isn't one. The
    frontend's `apiFetchAll` does exactly that.
    """

    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200
