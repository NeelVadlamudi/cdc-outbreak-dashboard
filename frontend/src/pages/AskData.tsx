import { useState, useEffect, useRef } from "react";
import { MessageSquare, ArrowRight, AlertTriangle } from "lucide-react";
import { askAgent } from "../api";
import type { AdaptedAskResponse } from "../agent/contract";
import AgentAnswer from "../components/AgentAnswer";

const SUGGESTED_QUESTIONS = [
  "What's the COVID risk level right now?",
  "Which states have high respiratory illness activity?",
  "What are the current test positivity rates?",
  "How are hospitalization rates trending?",
  "Show me a summary of this week's data",
  "What's happening with flu activity?",
];

type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; result: AdaptedAskResponse }
  | { role: "assistant"; error: string; question: string };

export default function AskData() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (question: string) => {
    if (!question.trim()) return;
    const q = question.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setLoading(true);

    try {
      const result = await askAgent(q);
      setMessages((prev) => [...prev, { role: "assistant", result }]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Request failed";
      setMessages((prev) => [...prev, { role: "assistant", error: message, question: q }]);
    }
    setLoading(false);
  };

  return (
    <div className="page-container">
      <div className="page-header fade-in" style={{ marginBottom: 20 }}>
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Ask a question</h1>
            <p className="page-subtitle">
              Ask in plain English about COVID, flu, or RSV. Answers come from the CDC data behind this dashboard.
            </p>
          </div>
        </div>
      </div>

      <div className="fade-in">
        <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 560, padding: 0 }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
            {messages.length === 0 && (
              <div className="empty-state">
                <MessageSquare size={40} strokeWidth={1.5} color="#6b6b6b" style={{ margin: "0 auto 14px" }} />
                <h3>Try a question about this week’s data</h3>
                <p>
                  You’ll see the answer, the data week it used, and (if you want) which sources it checked.
                </p>
                <div className="suggest-list">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button key={q} type="button" className="suggest-btn" onClick={() => sendMessage(q)}>
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`chat-message ${msg.role}`}>
                <div className="chat-avatar">
                  {msg.role === "assistant" ? <MessageSquare size={18} /> : null}
                </div>
                <div className="message-bubble">
                  {msg.role === "user" && "content" in msg && msg.content}
                  {"result" in msg && msg.result && <AgentAnswer result={msg.result} />}
                  {"error" in msg && msg.error && (
                    <div className="agent-error" role="alert">
                      <AlertTriangle size={14} /> {msg.error}{" "}
                      <button
                        className="agent-calls-toggle"
                        onClick={() => sendMessage(msg.question)}
                        disabled={loading}
                      >
                        Retry
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="chat-message assistant">
                <div className="chat-avatar"><MessageSquare size={18} /></div>
                <div className="message-bubble" style={{ padding: "16px 20px", display: "flex", alignItems: "center", gap: 12 }} aria-live="polite">
                  <div className="loading-spinner" style={{ width: 20, height: 20, borderWidth: 2, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    Looking up your question… If the service has been idle, the first answer can take about a minute to wake up.
                  </span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div style={{
            borderTop: "1px solid var(--border-subtle)",
            padding: "16px 20px",
            background: "var(--bg-card)",
            borderBottomLeftRadius: "var(--radius-lg)",
            borderBottomRightRadius: "var(--radius-lg)",
          }}>
            <div className="chat-input-wrapper">
              <input
                type="text"
                className="chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
                placeholder="Ask about COVID, flu, RSV, risk levels…"
                aria-label="Ask a question about the data"
              />
              <button
                className="chat-submit-btn"
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
                aria-label="Send question"
              >
                <ArrowRight size={18} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
