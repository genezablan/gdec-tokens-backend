# 💬 Frontend Implementation Guide: AI Chat

## 📋 Project Brief

Implement the **AI Chat assistant** — a chat panel where a logged-in employee converses with the
platform's AI assistant (backed by the Anthropic Claude API, server-side).

The backend is **stateless**: it does not store conversations. The frontend keeps the message
history in component state (or localStorage if you want it to survive a refresh), sends the **full
history** on every request, and appends the reply it gets back.

### What the assistant can answer

- **App navigation & how-to** — "How do I book a coach?", "Where do I cancel a request?" The
  assistant knows the sidebar structure, routes, and role gating, and gives step-by-step text
  directions tailored to the signed-in user's roles.
- **Platform knowledge** — token rules, the request lifecycle/statuses, what each development
  option costs.
- **The user's own data** (live, queried server-side per request): token balance, their token
  requests and statuses, their coaching sessions (coaches see sessions they give).
- **Platform analytics** (admin / HR users only): request counts by status/type/department,
  session counts, top coaches, total token usage. Other roles asking for these get a polite
  "that's restricted" reply — **not** an HTTP error.

All data access is **read-only** and scoped server-side to the signed-in user — the model cannot
query another user's data regardless of what's typed into the chat.

---

## 🎯 Backend API Endpoints

**Base URL:** `http://localhost:3000/api`

All chat endpoints require a logged-in user (`Authorization: Bearer <token>`). Any role works —
there are no admin-only chat endpoints.

| Method | Endpoint       | Purpose                                                  | Auth Required |
| ------ | -------------- | -------------------------------------------------------- | ------------- |
| `GET`  | `/chat/status` | Is the AI configured? Use it to show/hide the chat UI    | Yes           |
| `POST` | `/chat`        | Send the conversation history, receive the next reply    | Yes           |

---

## ⚠️ Important Notes

- **The backend stores nothing.** Refreshing the page loses the conversation unless the frontend
  persists it (e.g. localStorage). "New chat" is purely a frontend action: clear the array.
- **Send the full history every time**, oldest first. The last message must be the user's new one.
- The **first message in the array must have `role: "user"`** — the API rejects histories that
  start with `assistant` (`400`).
- Roles may only be `"user"` or `"assistant"`. Don't insert system/notice messages into the array —
  keep UI-only banners out of the payload.
- Replies can take **several seconds** (it's a live LLM call), and **longer when the assistant
  looks up data** — a data question triggers one or more internal database queries plus extra
  model round-trips. Show a typing indicator and disable the send button while a request is in
  flight; don't set aggressive client-side timeouts (allow ~60s).
- Replies are plain text but will often contain **Markdown** (lists, bold, code). Render with a
  Markdown component, **not** `dangerouslySetInnerHTML`.
- Check `GET /chat/status` on mount. If `{ "available": false }`, hide the chat or show a
  "temporarily unavailable" state — `POST /chat` would return `503`.
- There is no hard message-count limit, but very long conversations cost more and respond slower.
  Consider capping the history you send (e.g. the last 30 messages).

### Error responses

| Status | Meaning                                  | Suggested UI                                  |
| ------ | ---------------------------------------- | --------------------------------------------- |
| `400`  | Bad payload (empty array, bad roles, …)  | Shouldn't happen with a correct client; log it |
| `401`  | Missing/expired JWT                      | Redirect to login (same as the rest of the app) |
| `429`  | AI rate-limited                          | "The assistant is busy — try again in a moment" + retry |
| `502`  | Upstream AI error                        | "Something went wrong — try again" + retry     |
| `503`  | AI not configured on the server          | Hide chat / show unavailable state             |

Error bodies follow the standard NestJS shape: `{ "statusCode": 429, "message": "…" }` — the
`message` is user-friendly and safe to display.

---

## 🔄 Conversation Flow

```
┌──────────┐                ┌──────────────┐              ┌────────────┐
│ Frontend │                │  NestJS API  │              │ Claude API │
└────┬─────┘                └──────┬───────┘              └─────┬──────┘
     │ GET /chat/status            │                            │
     │────────────────────────────►│                            │
     │ { available: true }         │                            │
     │◄────────────────────────────│                            │
     │                             │                            │
     │ POST /chat                  │                            │
     │ { messages: [history…,      │                            │
     │   new user message] }       │                            │
     │────────────────────────────►│  full conversation +       │
     │                             │  system prompt             │
     │                             │───────────────────────────►│
     │                             │            assistant reply │
     │                             │◄───────────────────────────│
     │ { reply: "…" }              │                            │
     │◄────────────────────────────│                            │
     │                             │                            │
     │ append { role: "assistant", │                            │
     │ content: reply } to local   │                            │
     │ history; repeat             │                            │
```

---

## 📐 Data Models

### POST /chat request body (`application/json`)

```typescript
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string; // non-empty
}

interface ChatRequestBody {
  messages: ChatMessage[]; // full history, oldest first; first must be role "user"
}
```

### POST /chat response

```typescript
interface ChatResponse {
  reply: string; // the assistant's answer — append it to local history as { role: "assistant" }
}
```

### GET /chat/status response

```typescript
interface ChatStatusResponse {
  available: boolean; // false ⇒ POST /chat would return 503; hide the chat UI
}
```

---

## 🧪 Curl Test Commands

### Status

```bash
curl http://localhost:3000/api/chat/status \
  -H "Authorization: Bearer <token>"
```

### First message

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
        "messages": [
          { "role": "user", "content": "How do I request coaching tokens?" }
        ]
      }'

# Response:
# { "reply": "To request coaching tokens, …" }
```

### Data question (assistant queries the DB server-side)

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
        "messages": [
          { "role": "user", "content": "How many tokens do I have left this year?" }
        ]
      }'

# Response (numbers come from a live DB lookup for the signed-in user):
# { "reply": "You have 4 tokens remaining for 2026 …" }
```

### Follow-up (send the whole history back)

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
        "messages": [
          { "role": "user",      "content": "How do I request coaching tokens?" },
          { "role": "assistant", "content": "To request coaching tokens, …" },
          { "role": "user",      "content": "Who approves the request?" }
        ]
      }'
```

---

## 🖥️ Frontend Requirements

- A chat panel (floating widget or page) showing the message history: user messages on one side,
  the assistant's on the other.
- Text input + send button. `Enter` sends; `Shift+Enter` inserts a newline.
- Typing indicator while the request is in flight; input disabled until the reply arrives or fails.
- Render assistant messages as Markdown.
- A "New chat" button that clears the local history.
- Hide the chat (or show an unavailable state) when `GET /chat/status` returns `available: false`.
- Inline error bubble with a retry option on `429`/`502` — keep the user's message in the input or
  history so nothing is lost.

### Reference implementation (React)

```typescript
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(text: string) {
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setSending(true);
    setError(null);

    try {
      // api.post attaches the Authorization header like the rest of the app
      const { reply } = await api.post('/chat', { messages: next });
      setMessages([...next, { role: 'assistant', content: reply }]);
    } catch (e) {
      // Keep the user's message in the history so they can retry
      setError(getApiErrorMessage(e)); // surface the server's `message` field
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setMessages([]);
    setError(null);
  }

  return { messages, sending, error, send, reset };
}
```

---

## 🛠️ Implementation Steps

### Phase 1 — Core chat

1. On mount, call `GET /chat/status`; render the chat only when `available` is `true`.
2. Build the message list + input. On send, append the user message locally and `POST /chat` with
   the full array.
3. Append `{ role: 'assistant', content: reply }` from the response. Auto-scroll to the bottom.
4. Typing indicator + disabled input while `sending`.

### Phase 2 — Robustness

1. Markdown rendering for assistant messages.
2. Error bubbles with retry for `429`/`502`; redirect on `401` like the rest of the app.
3. "New chat" button.
4. Cap the history sent to the last ~30 messages on long conversations.

### Phase 3 — Polish

1. Persist the conversation in localStorage so a refresh doesn't lose it.
2. Suggested starter prompts on an empty conversation ("How do I book a session?", …).
3. Optional: request a backend SSE endpoint for token-by-token streaming if the product wants a
   "live typing" effect — the current endpoint returns the complete reply in one response.

---

## ✅ Success Criteria

### Must Have

- [ ] Logged-in user can send a message and see the assistant's reply.
- [ ] Multi-turn conversations work (full history sent each time; context is preserved).
- [ ] Chat is hidden/disabled when `GET /chat/status` reports `available: false`.
- [ ] In-flight state: typing indicator shown, send disabled, no double-submits.
- [ ] `429`/`502` show a friendly retryable error without losing the user's message.

### Should Have

- [ ] Assistant messages rendered as Markdown.
- [ ] "New chat" clears the conversation.
- [ ] History capped before sending on very long conversations.

### Nice to Have

- [ ] Conversation persisted across refreshes (localStorage).
- [ ] Suggested starter prompts on an empty chat.
