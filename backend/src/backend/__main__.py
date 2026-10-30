import uvicorn


def main() -> None:
    # SSE streams never end on their own; cut them off so shutdown isn't held up.
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        timeout_graceful_shutdown=5,
    )


if __name__ == "__main__":
    main()
