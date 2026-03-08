import { useState, useEffect, useRef } from "react";
import { MessageSquare, Bot, ArrowRight, Activity, Cpu, ShieldAlert } from "lucide-react";
import { chatWithData, getWeeklyBrief } from "../api";

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
  const [brief, setBrief] = useState(null);
  const chatEndRef = useRef(null);

  useEffect(() => {
    getWeeklyBrief().then(setBrief).catch(() => {});
  }, []);

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
      const res = await chatWithData(q);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: res.answer,
          model: res.model,
          engine: res.engine,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, I couldn't process that question. Please try again.", model: "error" },
      ]);
    }
    setLoading(false);
  };

  return (
    <div className="page-container">
      <div className="page-header fade-in" style={{ marginBottom: "20px" }}>
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Neural Interface</h1>
            <p className="page-subtitle">
              Talk directly to the CDC SODA API via Mistral 7B + RAG
            </p>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "24px" }} className="fade-in">
        <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: "600px", padding: 0 }}>
          <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
            {messages.length === 0 && (
              <div style={{ textAlign: "center", padding: "40px 20px" }}>
                <Bot size={48} strokeWidth={1.5} color="#9CA3AF" style={{ margin: '0 auto 16px' }} />
                <h3 style={{ color: "var(--text-primary)", marginBottom: "8px", fontWeight: 800, fontSize: "20px" }}>
                  Ask anything about the outbreak data
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
                  Powered by RAG — queries the DuckDB database and generates insights
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
                  {msg.content}
                  {msg.model && msg.role === "assistant" && (
                    <div style={{
                      marginTop: "12px",
                      fontSize: "11px",
                      color: "var(--text-muted)",
                      borderTop: "1px solid var(--border-subtle)",
                      paddingTop: "12px",
                      fontWeight: 500,
                    }}>
                      {msg.engine === "ollama" ? "Mistral 7B (Ollama)" : "Data-driven analysis"} · {msg.model}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="chat-message assistant">
                <div className="chat-avatar"><Bot size={20} /></div>
                <div className="message-bubble" style={{ padding: "16px 20px" }}>
                  <div className="loading-spinner" style={{ width: "20px", height: "20px", borderWidth: "2px" }} />
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

        <div>
          <div className="card fade-in">
            <div className="card-header" style={{ marginBottom: "16px" }}>
              <span className="card-title"><Activity size={18} /> Weekly Health Brief</span>
            </div>
            {brief ? (
              <div style={{ fontSize: "14px", lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--text-secondary)" }}>
                {brief.brief}
              </div>
            ) : (
              <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading brief...</p>
            )}
          </div>

          <div className="card fade-in" style={{ marginTop: "24px" }}>
            <div className="card-header" style={{ marginBottom: "16px" }}>
              <span className="card-title"><Cpu size={18} /> Architecture</span>
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.6 }}>
              <div style={{ padding: "12px", background: "var(--accent-primary-glow)", borderRadius: "8px", marginBottom: "12px", border: "1px solid var(--border-accent)" }}>
                <strong style={{ color: "var(--accent-primary)" }}>RAG Pipeline:</strong><br />
                <span style={{ color: "var(--text-secondary)" }}>Question → DuckDB query → context injection → LLM response</span>
              </div>
              <div style={{ padding: "12px", background: "rgba(5, 150, 105, 0.1)", borderRadius: "8px", marginBottom: "12px", border: "1px solid rgba(5, 150, 105, 0.2)" }}>
                <strong style={{ color: "#059669" }}>LLM Engine:</strong><br />
                <span style={{ color: "var(--text-secondary)" }}>Ollama + Mistral 7B (local, privacy-first)</span>
              </div>
              <div style={{ padding: "12px", background: "rgba(217, 119, 6, 0.1)", borderRadius: "8px", border: "1px solid rgba(217, 119, 6, 0.2)" }}>
                <strong style={{ color: "#d97706" }}>Fallback Mechanism:</strong><br />
                <span style={{ color: "var(--text-secondary)" }}>Rule-based structured responses on DuckDB data</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
