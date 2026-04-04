from fastapi import Query
from pydantic import BaseModel


class PaginationParams(BaseModel):
    skip: int = Query(0, ge=0, description="Records to skip")
    limit: int = Query(50, ge=1, le=200, description="Max records to return")


class PaginatedResponse(BaseModel):
    total: int
    skip: int
    limit: int
    items: list
