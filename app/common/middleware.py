from contextvars import ContextVar
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

# Context variable that holds the current tenant_id for the request lifecycle
_current_tenant_id: ContextVar[int | None] = ContextVar("current_tenant_id", default=None)


def get_tenant_id() -> int | None:
    """Get the current tenant_id from request context."""
    return _current_tenant_id.get()


def set_tenant_id(tenant_id: int | None) -> None:
    """Set the current tenant_id in request context."""
    _current_tenant_id.set(tenant_id)


class TenantMiddleware(BaseHTTPMiddleware):
    """
    Middleware that extracts client_id from the JWT payload (set by auth)
    and makes it available via context variable for the entire request.

    This is used by the service/repository layers to automatically filter
    queries by tenant without passing client_id everywhere.

    For RLS to work at the DB level, the session event below sets
    the PostgreSQL session variable 'app.current_tenant'.
    """

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Reset tenant for each request
        set_tenant_id(None)
        response = await call_next(request)
        return response


async def set_tenant_on_session(session, tenant_id: int | None) -> None:
    """
    Call this after authentication to set the PostgreSQL session-level variable
    for Row-Level Security. Should be called in endpoints that need RLS.
    """
    if tenant_id is not None:
        set_tenant_id(tenant_id)
        await session.execute(
            sa_text(f"SET LOCAL app.current_tenant = '{tenant_id}'")
        )


# Import here to avoid circular imports
from sqlalchemy import text as sa_text  # noqa: E402
