"use strict";

// Chat UI for the HITL agent. All model and tool output is rendered through
// textContent / createElement, never by building markup from strings.

const STORE_KEY = "hitl.chats.v1";
const USER_KEY = "hitl.user";
const ENDPOINT = "/api/v1/astream";
const SVG_NS = "http://www.w3.org/2000/svg";
const FOLDER_PATH = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";
const TOOL_MARKER = "Do you approve the above tool call";

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2));

let store = loadStore();
let streaming = false;
let deleteTimer = null;

/* ---------- storage ---------- */

function loadStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    if (saved && Array.isArray(saved.chats)) {
      for (const chat of saved.chats) {
        for (const m of chat.messages) {
          delete m.status;
          if (m.role === "assistant" && !m.content && !m.error) m.error = "No response received from the agent.";
        }
      }
      return saved;
    }
  } catch (e) { /* unreadable storage: start empty */ }
  return { chats: [], activeId: null };
}

function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* private mode or full */ }
}

function userId() {
  try {
    let id = localStorage.getItem(USER_KEY);
    if (!id) {
      id = "web-" + uid().slice(0, 8);
      localStorage.setItem(USER_KEY, id);
    }
    return id;
  } catch (e) {
    return "web-anon";
  }
}

/* ---------- chats ---------- */

const activeChat = () => store.chats.find((c) => c.id === store.activeId);

function blankChat() {
  return { id: uid(), title: "New chat", updatedAt: Date.now(), messages: [], previous_node: null, current_plan: "" };
}

function startNewChat() {
  if (streaming) return;
  let chat = store.chats.find((c) => c.messages.length === 0);
  if (!chat) {
    chat = blankChat();
    store.chats.unshift(chat);
  }
  store.activeId = chat.id;
  saveStore();
  render();
  $("input").focus();
}

function openChat(id) {
  if (streaming) return;
  store.activeId = id;
  saveStore();
  render();
}

/* ---------- rendering ---------- */

function render() {
  $("chat-title").textContent = activeChat().title;
  renderMessages();
  renderHistory();
}

function renderMessages() {
  const box = $("messages");
  const chat = activeChat();
  const stick = box.childElementCount === 0 || box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.replaceChildren();
  if (!chat.messages.length) {
    const empty = el("div", "empty");
    empty.append(el("div", null, "Ask the agent to do something."), el("div", null, "It shows a plan and waits for your approval."));
    box.append(empty);
    return;
  }
  const last = chat.messages.length - 1;
  chat.messages.forEach((m, i) => box.append(m.role === "user" ? userNode(m) : assistantNode(m, i === last)));
  if (stick) box.scrollTop = box.scrollHeight;
}

function userNode(m) {
  const row = el("div", "msg-user");
  row.append(el("div", "bubble", m.content), el("div", "avatar", "You"));
  return row;
}

// Splits an assistant message into plain text and, when present, an approval card.
function splitCard(text) {
  const plan = text.match(/<plan>([\s\S]*?)<\/plan>/);
  if (plan) {
    return {
      before: text.slice(0, plan.index).trim(),
      card: { label: "Plan", body: plan[1].trim(), question: text.slice(plan.index + plan[0].length).trim() },
    };
  }
  const at = text.indexOf(TOOL_MARKER);
  if (at !== -1) {
    return { before: "", card: { label: "Tool call", body: text.slice(0, at).trim(), question: text.slice(at).trim() } };
  }
  return { before: text, card: null };
}

function assistantNode(m, isLast) {
  const wrap = el("div", "msg-assistant");
  if (m.content) {
    const { before, card } = splitCard(m.content);
    if (before) wrap.append(document.createTextNode(before));
    if (card) wrap.append(cardNode(card, m, isLast));
  } else if (m.status) {
    wrap.append(el("span", "status", m.status));
  }
  if (m.error) wrap.append(el("div", "notice", m.error));
  return wrap;
}

function cardNode(card, m, isLast) {
  const node = el("div", "card");
  node.append(el("div", "card-label", card.label), el("pre", null, card.body));
  if (card.question) node.append(el("div", "card-q", card.question));
  if (m.decided) {
    node.append(el("span", "decision", m.decided === "yes" ? "Approved" : "Rejected"));
  } else if (isLast) {
    const row = el("div", "card-actions");
    const approve = el("button", "btn primary", "Approve");
    const reject = el("button", "btn", "Reject");
    approve.type = "button";
    reject.type = "button";
    approve.disabled = reject.disabled = streaming;
    approve.addEventListener("click", () => decide(m, "yes"));
    reject.addEventListener("click", () => decide(m, "no"));
    row.append(approve, reject);
    node.append(row);
  }
  return node;
}

function folderIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  const attrs = { viewBox: "0 0 24 24", width: "22", height: "22", fill: "none", stroke: "currentColor", "stroke-width": "1.6", "stroke-linejoin": "round" };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", FOLDER_PATH);
  svg.append(path);
  return svg;
}

function renderHistory() {
  const list = $("history-list");
  list.replaceChildren();
  const chats = store.chats.filter((c) => c.messages.length).sort((a, b) => b.updatedAt - a.updatedAt);
  if (!chats.length) {
    list.append(el("li", "history-empty", "No conversations yet"));
    return;
  }
  for (const chat of chats) {
    const item = el("button", "history-item" + (chat.id === store.activeId ? " active" : ""));
    item.type = "button";
    const text = el("span", "history-text");
    text.append(el("span", "history-title", chat.title), el("span", "history-sub", chat.messages[0].content));
    item.append(folderIcon(), text);
    item.addEventListener("click", () => openChat(chat.id));
    const li = el("li");
    li.append(item);
    list.append(li);
  }
}

/* ---------- sending and streaming ---------- */

function setStreaming(value) {
  streaming = value;
  $("send").disabled = value;
}

function decide(message, answer) {
  if (streaming) return;
  message.decided = answer;
  send(answer);
}

async function send(raw) {
  const text = raw.trim();
  if (!text || streaming) return;
  const chat = activeChat();
  chat.messages.push({ role: "user", content: text });
  if (chat.messages.length === 1) chat.title = text.length > 40 ? text.slice(0, 40) + "…" : text;
  chat.updatedAt = Date.now();
  const history = chat.messages.map((m) => ({ role: m.role, content: m.content }));
  const reply = { role: "assistant", content: "", status: "Agent is thinking..." };
  chat.messages.push(reply);
  setStreaming(true);
  saveStore();
  render();
  try {
    await streamReply(chat, reply, text, history);
  } catch (e) {
    reply.error = "Connection error: " + e.message;
  } finally {
    delete reply.status;
    if (!reply.content && !reply.error) reply.error = "No response received from the agent.";
    chat.updatedAt = Date.now();
    setStreaming(false);
    saveStore();
    render();
  }
}

async function streamReply(chat, reply, message, messages) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: userId(),
      session_id: chat.id,
      message,
      messages,
      previous_node: chat.previous_node,
      current_plan: chat.current_plan,
      params: {},
    }),
  });
  if (!res.ok) throw new Error("API returned " + res.status);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      if (handleEvent(block, chat, reply)) {
        await reader.cancel();
        return;
      }
    }
  }
}

// Returns true when the stream is finished. Event types follow the API: status/think/node_change,
// plan, message, complete, error.
function handleEvent(block, chat, reply) {
  const line = block.split("\n").find((l) => l.startsWith("data:"));
  if (!line) return false;
  let data;
  try { data = JSON.parse(line.slice(5).trim()); } catch (e) { return false; }
  const type = data.type || "";
  const content = data.content || "";
  if (type === "error") {
    reply.error = content || "The agent returned an error.";
    return true;
  }
  if (type === "complete") {
    if (data.full_response) reply.content = data.full_response;
    return true;
  }
  if (!content) return false;
  if (data.previous_node) chat.previous_node = data.previous_node;
  if (type === "plan") {
    chat.current_plan = content.replace("Plan updated: ", "");
  } else if (type === "message" || type === "msg") {
    reply.content += content;
    delete reply.status;
  } else {
    reply.status = content.replace(/\*\*/g, "").trim();
  }
  render();
  return false;
}

/* ---------- controls ---------- */

function flash(labelId, text) {
  const node = $(labelId);
  const original = node.dataset.label || node.textContent;
  node.dataset.label = original;
  node.textContent = text;
  setTimeout(() => { node.textContent = original; }, 1500);
}

function resetDeleteLabel() {
  deleteTimer = null;
  $("delete-label").textContent = "Delete history";
}

$("new-chat").addEventListener("click", startNewChat);

$("copy-chat").addEventListener("click", async () => {
  const text = activeChat().messages.map((m) => (m.role === "user" ? "You: " : "Agent: ") + m.content).join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
    flash("copy-label", "Copied");
  } catch (e) {
    flash("copy-label", "Copy failed");
  }
});

// Two clicks instead of a browser confirm dialog.
$("delete-history").addEventListener("click", () => {
  if (streaming) return;
  if (!deleteTimer) {
    $("delete-label").textContent = "Click again to confirm";
    deleteTimer = setTimeout(resetDeleteLabel, 3000);
    return;
  }
  clearTimeout(deleteTimer);
  resetDeleteLabel();
  store = { chats: [], activeId: null };
  startNewChat();
});

const input = $("input");
const autosize = () => {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 144) + "px";
};
input.addEventListener("input", autosize);
input.addEventListener("keydown", (e) => {
  // isComposing: Enter confirms an IME candidate (e.g. Vietnamese) and must not send.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("composer").requestSubmit();
  }
});
$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value;
  input.value = "";
  autosize();
  send(text);
});

if (activeChat()) render();
else startNewChat();
