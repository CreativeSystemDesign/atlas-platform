"""Cross-platform launcher for the Atlas Agent Server.

Why this exists: on Windows, psycopg's async pool cannot run on the default
ProactorEventLoop ("Psycopg cannot use the 'ProactorEventLoop'"). The loop must
be a SelectorEventLoop.

Two Windows gotchas conspire here:
  1. `python -m uvicorn src.main:app` creates the serving loop *before* importing
     the app, so the policy set in main.py runs too late.
  2. `uvicorn.run()` calls its own `Config.setup_event_loop()`, which resets the
     Windows loop back to Proactor — clobbering any policy we set first.

So we bypass uvicorn's loop setup entirely: build the Server, then drive
`server.serve()` on a SelectorEventLoop we create ourselves.

Usage (from the agent_server directory):
    python run_server.py            # production-style
    python run_server.py --reload   # autoreload for development
"""

import asyncio
import os
import sys

import uvicorn


def main() -> None:
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8123"))
    reload = "--reload" in sys.argv

    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

    config = uvicorn.Config("src.main:app", host=host, port=port, reload=reload)

    # On non-Windows (or when reload is requested, which needs uvicorn's process
    # supervisor) use the normal entrypoint. Otherwise drive serve() on a
    # Selector loop so psycopg's async pool works.
    if sys.platform != "win32" or reload:
        uvicorn.Server(config).run()
        return

    server = uvicorn.Server(config)
    asyncio.run(server.serve(), loop_factory=asyncio.SelectorEventLoop)


if __name__ == "__main__":
    main()
