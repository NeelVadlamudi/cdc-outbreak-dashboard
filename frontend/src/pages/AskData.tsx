import { useState, useEffect, useRef } from "react";
import { MessageSquare, ArrowRight, Info, Link2 } from "lucide-react";
import { askAgent } from "../api";
import type { AdaptedAskResponse } from "../agent/contract";
import AgentAnswer from "../components/AgentAnswer";
import { getParam, setParams } from "../lib/urlState";

const SUGGESTED_QUESTIONS = [
  // Hospital / clinic ops
  "Which states are High or Very High this CDC week?",
  // Infection prevention / nursing
  "What's COVID-19 test positivity in plain English?",
  // Research coordinator
  "What is the latest RESP-NET COVID-NET overall hospitalization rate and week ending?",
  // Epidemiologist / analyst
  "How do COVID, flu, and RSV test positivity compare this week?",
  // Educator / sitrep
  "Summarize this week's ARI activity with the CDC week stamp",
  "Is any current surveillance table marked stale?",
];

type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; result: AdaptedAskResponse }
  | { role: "assistant"; error: string; question: string };

export default function AskData() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [shareHint, setShareHint] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const bootstrapped = useRef(false);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (question: string) => {
    if (!question.trim()) return;
    const q = question.trim();
    setInput("");
    setParams({ q });
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

  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    const q = getParam("q", "");
    if (q) {
      setInput(q);
      void sendMessage(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once from URL
  }, []);

  const copyShareLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareHint("Link copied — includes your question in ?q=");
    } catch {
      setShareHint("Copy the address bar — ?q= is the shareable question");
    }
    window.setTimeout(() => setShareHint(null), 2500);
  };

  return (
    <div className="page-container">
      <div className="page-header fade-in" style={{ marginBottom: 20 }}>
        <div className="page-header-row">
          <div>
            <h1 className="page-title">Ask a question</h1>
            <p className="page-subtitle">
              For ops leads, infection prevention, research coordinators, and analysts who need this week’s CDC
              respiratory figures with tool receipts—not free-form chat.
            </p>
            <p className="page-disclaimer">
              Open source and free to use (MIT). For research, education, and situational awareness—not clinical
              decision-making or official CDC guidance. Numbers are epidemiology-week surveillance, not live case counts.
            </p>
          </div>
          <button type="button" className="filter-btn" onClick={copyShareLink} title="Copy shareable link">
            <Link2 size={14} /> Share view
          </button>
        </div>
        {shareHint ? <p className="page-disclaimer" role="status">{shareHint}</p> : null}
      </div>

      <div className="fade-in">
        <div className="card" style={{ display: "flex", flexDirection: "column", minHeight: 560, padding: 0 }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
            {messages.length === 0 && !loading && (
              <div className="empty-state">
                <MessageSquare size={40} strokeWidth={1.5} color="#6b6b6b" style={{ margin: "0 auto 14px" }} />
                <h3>Try a question about this week’s data</h3>
                <p>
                  You’ll see the answer, the data week it used, tool steps, latency, and (if available) token counts.
                  Shareable links use <code>?q=</code>.
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
                    <div className="agent-error" role="status">
                      <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span>
                        Ask temporarily unavailable. {msg.error} This is a service status
                        note—not a disease alert.
                      </span>{" "}
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
                placeholder="Ask about COVID, flu, RSV, or this week’s ARI activity…"
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
