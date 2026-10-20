import { useState, useEffect, useRef } from "react";
import { Bot, ArrowRight, AlertTriangle } from "lucide-react";
import { askAgent } from "../api";
import AgentAnswer from "../components/AgentAnswer";

const SUGGESTED_QUESTIONS = [
  "What's the COVID risk level right now?",
  "Which states have high respiratory illness activity?",
  "What are the current test positivity rates?",
  "How are hospitalization rates trending?",
  "Show me a summary of this week's data",
  "What's happening with flu activity?",
];

export default function AskData() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (question) => {
    if (!question.trim()) return;
    const q = question.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setLoading(true);

    try {
      const result = await askAgent(q);
      setMessages((prev) => [...prev, { role: "assistant", result }]);
    } catch (err) {
      setMessages((prev) => [...prev, { role: "assistant", error: err?.message || "Request failed", question: q }]);
    }
    setLoading(false);
  };

  return (
    <div className="page-container">
      <div className="page-header fade-in" style={{ marginBottom: "20px" }}>
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Live data question box</h1>
            <p className="page-subtitle">
              Answers come from tool calls on the CDC data; every call is listed under the answer
            </p>
          </div>
        </div>
      </div>

      <div className="fade-in">
        <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "600px", padding: 0 }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
            {messages.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <Bot size={48} strokeWidth={1.5} color="#9CA3AF" style={{ margin: '0 auto 16px' }} />
                <h3 style={{ color: "var(--text-primary)", marginBottom: "8px", fontWeight: 800, fontSize: "20px" }}>
                  Ask anything about the outbreak data
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
                  Each answer shows the tools it called, the data week, and how long it took
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center", marginTop: "32px" }}>
                  {SUGGESTED_QUESTIONS.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(q)}
                      style={{
                        padding: "8px 16px",
                        borderRadius: "20px",
                        border: "1px solid var(--border-light)",
                        background: "var(--bg-elevated)",
                        color: "var(--text-secondary)",
                        cursor: "pointer",
                        fontSize: "13px",
                        fontWeight: 500,
                        transition: "all 0.2s",
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.background = "var(--bg-card)";
                        e.target.style.borderColor = "var(--accent-primary)";
                        e.target.style.color = "var(--accent-primary)";
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.background = "var(--bg-elevated)";
                        e.target.style.borderColor = "var(--border-light)";
                        e.target.style.color = "var(--text-secondary)";
                      }}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`chat-message ${msg.role}`}>
                <div className="chat-avatar">
                  {msg.role === "assistant" ? <Bot size={20} /> : null}
                </div>
                <div className="message-bubble">
                  {msg.role === "user" && msg.content}
                  {msg.result && <AgentAnswer result={msg.result} />}
                  {msg.error && (
                    <div className="agent-error" role="alert">
                      <AlertTriangle size={14} /> {msg.error}{" "}
                      <button className="agent-calls-toggle" onClick={() => sendMessage(msg.question)} disabled={loading}>Retry</button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="chat-message assistant">
                <div className="chat-avatar"><Bot size={20} /></div>
                <div className="message-bubble" style={{ padding: "16px 20px" }} aria-live="polite">
                  <div className="loading-spinner" style={{ width: "20px", height: "20px", borderWidth: "2px" }} />
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Agent is querying the data…</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div style={{
            borderTop: "1px solid var(--border-subtle)",
            padding: "20px 24px",
            background: "var(--bg-card)",
            borderBottomLeftRadius: "var(--radius-xl)",
            borderBottomRightRadius: "var(--radius-xl)",
          }}>
            <div className="chat-input-wrapper">
              <input
                type="text"
                className="chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage(input)}
                placeholder="Ask about COVID, flu, RSV trends, risk levels..."
              />
              <button
                className="chat-submit-btn"
                onClick={() => sendMessage(input)}
                disabled={loading || !input.trim()}
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
