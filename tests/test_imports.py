import importlib
from pathlib import Path

import pytest

# Not listed on purpose: agent.nodes.execute.execute (dead code, imports a missing module).
MODULES = [
    "hitl_agent.config",
    "hitl_agent.api.main",
    "hitl_agent.agent.graph",
    "hitl_agent.mcp_client.manager",
    "hitl_agent.mcp_servers.math.server",
]


@pytest.mark.parametrize("name", MODULES)
def test_modules_import(name):
    importlib.import_module(name)


def test_default_mcp_config_exists():
    from hitl_agent.config import Settings

    default = Settings.model_fields["MCP_SERVER_CONFIGS_PATH"].default
    assert Path(default).is_file()


def test_math_server_uses_its_own_settings():
    from hitl_agent.mcp_servers.math import server

    assert server.settings.SERVER_PORT == 3111
