import os
from pathlib import Path

# Settings validates these at import time; fake values are enough for import checks.
for key in ("OPENAI_API_KEY", "LANGFUSE_SECRET_KEY", "LANGFUSE_PUBLIC_KEY"):
    os.environ.setdefault(key, "test")
os.environ.setdefault("LANGFUSE_HOST", "http://localhost:3000")
# A developer's local .env may still point at an old path and would override the default.
os.environ["MCP_SERVER_CONFIGS_PATH"] = "configs/mcp_servers.json"

# Config paths are relative to the repo root and read at import time.
os.chdir(Path(__file__).resolve().parents[1])
