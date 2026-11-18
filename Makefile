PY := $(if $(wildcard .venv/bin/python),.venv/bin/python,python)

.PHONY: mcp api ui test

mcp:
	$(PY) -m hitl_agent.mcp_servers.math.server

api:
	$(PY) -m uvicorn hitl_agent.api.main:app --host 0.0.0.0 --port 8000

ui:
	$(PY) -m streamlit run src/hitl_agent/ui/streamlit_app.py

test:
	$(PY) -m pytest
