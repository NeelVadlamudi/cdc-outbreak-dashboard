import { useCallback, useEffect, useState } from "react";
import { getMirageProposals, getMirageAuditLog, decideProposal } from "../api";
import { PENDING, canDecide, isDemo, actionLabel } from "../mirage/contract.js";

const fmt = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
};
const Who = ({ name }) => (name == null ? "—" : (
  <span>{name}{isDemo(name) && <span className="mirage-demo" style={{ marginLeft: 6, padding: "1px 7px", borderRadius: 999, background: "var(--accent-primary)", color: "#111", fontSize: 11, fontWeight: 700 }}>Demo</span>}</span>
));

export default function MirageReview() {
  const [pending, setPending] = useState(null);
  const [log, setLog] = useState(null);
  const [loadError, setLoadError] = useState("");
  // The key lives only in this component's memory for the session; it is never persisted.
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  const apply = useCallback(([p, a]) => {
    setPending(Array.isArray(p?.proposals) ? p.proposals : []);
    setLog(Array.isArray(a?.audit_log) ? a.audit_log : []);
    setLoadError("");
  }, []);
  const fail = useCallback((e) => setLoadError(e?.message || "Could not load the review queue"), []);
  const fetchQueue = () => Promise.all([getMirageProposals(PENDING), getMirageAuditLog()]);
  const refresh = () => fetchQueue().then(apply, fail);
  useEffect(() => {
    let live = true;
    fetchQueue().then((r) => { if (live) apply(r); }, (e) => { if (live) fail(e); });
    return () => { live = false; };
  }, [apply, fail]);

  const decide = async (p, decision) => {
    setBusy(`${p.id}:${decision}`); setMessage(null);
    try {
      const out = await decideProposal(p.id, decision, { key, decidedBy: name, note });
      setMessage({ ok: true, text: `Proposal ${p.id} ${out?.proposal?.status ?? decision + "d"}.` });
      setNote("");
      await refresh();
    } catch (e) {
      setMessage({ ok: false, text: e?.message || "Request failed" });
    }
    setBusy(null);
  };

  const ready = key.trim() !== "" && name.trim() !== "";
  return (
    <div className="page-container">
      <div className="page-header fade-in" style={{ marginBottom: 20 }}>
        <h1 className="page-title">Mirage review</h1>
        <p className="page-subtitle">Approve or reject the next steps the audit agent queued. A decision is final and is recorded in the audit log; it changes no count.</p>
      </div>

      <div className="card fade-in" style={{ marginBottom: 20 }}>
        <form onSubmit={(e) => e.preventDefault()} style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }} autoComplete="off">
          <label>Admin key
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" name="mirage-admin-key" style={{ width: "100%" }} />
          </label>
          <label>Your name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>Note (optional)
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} style={{ width: "100%" }} />
          </label>
        </form>
        <p className="page-subtitle" style={{ marginTop: 8 }}>The key is kept in memory for this page only and sent as the X-API-Key header.</p>
        {message && <p role="status" style={{ color: message.ok ? "inherit" : "var(--accent-primary)" }}>{message.text}</p>}
      </div>

      {loadError && <div className="card" role="alert">{loadError}</div>}

      <div className="card fade-in" style={{ marginBottom: 20 }}>
        <h3>Waiting for approval{pending ? ` · ${pending.length}` : ""}</h3>
        {pending == null ? <p>Loading…</p> : pending.length === 0 ? <p>No proposals waiting</p> : pending.map((p) => (
          <div key={p.id} style={{ borderTop: "1px solid var(--border-color, #222)", padding: "12px 0" }}>
            <div><b>Proposal {p.id}</b> · {p.club} · {p.sku_name} ({p.sku_id}) → <b>{actionLabel(p.action)}</b></div>
            <div style={{ opacity: 0.8 }}>{p.reason}</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>created {fmt(p.created_at)} · {p.status}</div>
            {canDecide(p) && (
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button type="button" disabled={!ready || !!busy} onClick={() => decide(p, "approve")}>{busy === `${p.id}:approve` ? "Approving…" : "Approve"}</button>
                <button type="button" disabled={!ready || !!busy} onClick={() => decide(p, "reject")}>{busy === `${p.id}:reject` ? "Rejecting…" : "Reject"}</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card fade-in">
        <h3>Recorded decisions{log ? ` · ${log.length}` : ""}</h3>
        {log == null ? <p>Loading…</p> : log.length === 0 ? <p>No decisions recorded</p> : (
          <div style={{ overflowX: "auto" }}>
            <table className="mirage-table">
              <thead><tr><th>#</th><th>Proposal</th><th>Decision</th><th>Decided by</th><th>Decided at</th><th>Note</th></tr></thead>
              <tbody>{log.map((a) => (
                <tr key={a.id}><td>{a.id}</td><td>{a.proposal_id}</td><td>{a.decision}</td><td><Who name={a.decided_by} /></td><td>{fmt(a.decided_at)}</td><td>{a.note ?? "—"}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
