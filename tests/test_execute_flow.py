import asyncio

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.runnables import RunnableLambda

from hitl_agent.agent.nodes.execute import execute_hitl, tool


class FakeTool:
    name = "add"

    async def ainvoke(self, args):
        return args["a"] + args["b"]


def tool_call(call_id):
    return AIMessage(
        content="",
        tool_calls=[{"name": "add", "args": {"a": 1, "b": 2}, "id": call_id, "type": "tool_call"}],
    )


def stub_llm(replies, seen, approval_answer="yes"):
    """LLM stand-in. As the agent it records the messages it is sent and returns the queued replies;
    as the approval checker it answers `approval_answer`."""
    stub = RunnableLambda(lambda _: AIMessage(content=approval_answer))

    def bind_tools(_tools):
        def run(prompt_value):
            seen.append(prompt_value.to_messages())
            return replies.pop(0)

        return RunnableLambda(run)

    stub.bind_tools = bind_tools
    return stub


def assert_tool_calls_answered(messages):
    """OpenAI rejects a tool_calls message that is not followed by one ToolMessage per call id."""
    for i, msg in enumerate(messages):
        if isinstance(msg, AIMessage) and msg.tool_calls:
            wanted = {c["id"] for c in msg.tool_calls}
            answered = set()
            for following in messages[i + 1:]:
                if not isinstance(following, ToolMessage):
                    break
                answered.add(following.tool_call_id)
            assert answered == wanted, f"tool calls without a result: {wanted - answered}"


def start(monkeypatch, replies, approval_answer="yes"):
    seen = []
    monkeypatch.setattr(execute_hitl, "llm", stub_llm(replies, seen, approval_answer))
    monkeypatch.setattr(execute_hitl, "get_tools", lambda: [FakeTool()])
    monkeypatch.setattr(tool, "get_tools", lambda: [FakeTool()])
    state = {"messages": [HumanMessage("add 1 and 2")], "previous_node": "Plan", "plan": "1. add"}
    return seen, state


def step(state, node):
    result = node(state)
    state.update(asyncio.run(result) if asyncio.iscoroutine(result) else result)


def checkpoint(state):
    """The local checkpointer stores a pending AIMessage as its list of tool calls."""
    state["tool_message"] = state["tool_message"].tool_calls


def run_approved(monkeypatch, replies):
    """LLM -> (human approves) -> tool -> LLM, repeated while the LLM keeps calling tools."""
    seen, state = start(monkeypatch, replies)
    step(state, execute_hitl.execute_node)
    while state["next_node"] == "CheckHumanApproval":
        assert state["approval_status"] == "not_requested"
        assert state["tool_outputs"] == []
        checkpoint(state)
        state.update(approval_status="approved", previous_node="CheckHumanApproval")
        step(state, tool.tool_node)
        step(state, execute_hitl.execute_node)
    return seen, state


def test_tool_result_follows_its_tool_call(monkeypatch):
    seen, state = run_approved(monkeypatch, [tool_call("call_1"), AIMessage(content="3")])

    assert_tool_calls_answered(seen[-1])
    assert any(isinstance(m, ToolMessage) and m.content == "3" for m in seen[-1])
    assert state["next_node"] == "END"


def test_second_tool_round_needs_a_fresh_approval(monkeypatch):
    replies = [tool_call("call_1"), tool_call("call_2"), AIMessage(content="done")]
    seen, state = run_approved(monkeypatch, replies)

    assert_tool_calls_answered(seen[-1])
    assert state["next_node"] == "END"


def test_finished_run_leaves_no_stale_tool_outputs(monkeypatch):
    _, state = run_approved(monkeypatch, [tool_call("call_1"), AIMessage(content="3")])

    assert state["tool_outputs"] == []


def test_rejected_tool_call_goes_back_to_the_llm(monkeypatch):
    seen, state = start(monkeypatch, [tool_call("call_1"), AIMessage(content="Okay, not running it.")], "no")
    step(state, execute_hitl.execute_node)
    checkpoint(state)
    state.update(approval_status="pending", previous_node="Execute->CheckHumanApproval")
    state["messages"].append(HumanMessage("no"))

    step(state, execute_hitl.human_approval_node)
    assert state["approval_status"] == "rejected"
    step(state, execute_hitl.execute_node)

    assert state["next_node"] == "END"
    assert_tool_calls_answered(seen[-1])
