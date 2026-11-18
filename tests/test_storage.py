import pytest
from langchain_core.messages import AIMessage
from langgraph.checkpoint.base import empty_checkpoint

from hitl_agent.storage import LocalCheckpointSaver

CALLS = [{"name": "add", "args": {"a": 1, "b": 2}, "id": "call_1", "type": "tool_call"}]
CONFIG = {"configurable": {"thread_id": "t", "checkpoint_ns": ""}}
METADATA = {"step": 1, "source": "loop", "writes": {}, "parents": {}}


@pytest.mark.parametrize(
    "tool_message",
    [
        pytest.param(AIMessage(content="", tool_calls=CALLS), id="message"),
        # After a reload the state holds the stored list; saving it again (e.g. the user rejects the call).
        pytest.param(CALLS, id="already-a-list"),
    ],
)
def test_tool_message_is_stored_as_its_tool_calls(tmp_path, tool_message):
    saver = LocalCheckpointSaver(db_path=str(tmp_path))
    checkpoint = empty_checkpoint()
    checkpoint["channel_values"] = {"tool_message": tool_message}

    saver.put(CONFIG, checkpoint, METADATA, {})

    saved = saver.get_tuple(CONFIG)
    assert saved.checkpoint["channel_values"]["tool_message"] == CALLS
