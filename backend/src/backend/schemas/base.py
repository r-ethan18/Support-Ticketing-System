from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base for all schemas: snake_case in Python, camelCase on the wire (as in the ER)."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        from_attributes=True,
    )


class Page[T](CamelModel):
    """Envelope for offset-paginated collections."""

    items: list[T]
    total: int
    limit: int
    offset: int
