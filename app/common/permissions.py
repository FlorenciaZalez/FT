from functools import wraps
from fastapi import Depends
from app.auth.dependencies import get_current_user
from app.auth.models import User, UserRole
from app.common.exceptions import ForbiddenError


def tenant_filter(query, model, user: User):
    """
    Apply tenant filtering to a SQLAlchemy query.
    Admins and operators without a specific client see everything.
    Clients see only their own data.
    """
    if user.role in (UserRole.admin, UserRole.operator):
        return query
    if user.client_id is None:
        raise ForbiddenError("User has no associated client")
    return query.where(model.client_id == user.client_id)


def check_tenant_access(user: User, resource_client_id: int) -> None:
    """Raise ForbiddenError if user can't access this tenant's resource."""
    if user.role == UserRole.admin:
        return
    if user.client_id != resource_client_id:
        raise ForbiddenError("Access denied to this resource")
