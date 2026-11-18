PY := $(if $(wildcard .venv/bin/python),.venv/bin/python,python)

.PHONY: mcp api test

mcp:
	$(PY) -m hitl_agent.mcp_servers.math.server

api:
	$(PY) -m uvicorn hitl_agent.api.main:app --host 0.0.0.0 --port 8000

test:
	$(PY) -m pytest
