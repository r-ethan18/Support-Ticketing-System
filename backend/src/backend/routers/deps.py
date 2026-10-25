from typing import Annotated

from fastapi import Depends, Query


class Pagination:
    def __init__(
        self,
        limit: Annotated[int, Query(ge=1, le=100)] = 25,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> None:
        self.limit = limit
        self.offset = offset


PaginationDep = Annotated[Pagination, Depends()]
