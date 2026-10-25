"""Dump the API's OpenAPI spec to a YAML file.

    uv run python -m backend.openapi [-o openapi.yml]

Relative output paths resolve against the current directory. The pre-commit hook
runs this from `backend/`, so the spec lands at `backend/openapi.yml`.
"""

import argparse
from pathlib import Path

import yaml

from backend.main import create_app


def render_spec() -> str:
    spec = create_app().openapi()
    return yaml.safe_dump(spec, sort_keys=False, allow_unicode=True)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "-o", "--output", type=Path, default=Path("openapi.yml"), help="output file"
    )
    args = parser.parse_args(argv)
    args.output.write_text(render_spec(), encoding="utf-8")


if __name__ == "__main__":
    main()
