"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "../../_lib/api.js";

export default function BoardPage() {
  const { id } = useParams();
  const [board, setBoard] = useState(null);
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api(`/api/signboards/${id}`);
      setBoard(r.signboard);
      setMessages(r.messages);
    } catch (e) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function advance() {
    setStatus("Advancing…");
    try {
      const r = await api(`/api/signboards/${id}/rotate`, { method: "POST" });
      setStatus(`${r.status}${r.title ? `: "${r.title}"` : ""}`);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function move(index, dir) {
    const next = [...messages];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setMessages(next);
    await api(`/api/signboards/${id}/reorder`, {
      method: "POST",
      body: { order: next.map((m) => m.id) },
    });
  }

  if (!board) return <main>{error ? <div className="error">{error}</div> : "Loading…"}</main>;

  return (
    <>
      <header className="top">
        <h1>{board.name}</h1>
        <Link href="/">
          <button className="ghost">← All boards</button>
        </Link>
      </header>
      <main>
        {error && <div className="error">{error}</div>}

        <BoardSettings board={board} onSaved={load} />

        <div className="panel">
          <div className="row">
            <div className="grow">
              <strong>Rotation</strong>{" "}
              <span className="muted small">
                runs every minute via cron · durations are in seconds (rounded up
                to the next minute on the free Vercel tier)
              </span>
            </div>
            <button onClick={advance}>Advance now ⏭</button>
          </div>
          {status && <div className="ok small" style={{ marginTop: 8 }}>{status}</div>}
        </div>

        <div className="row" style={{ justifyContent: "space-between", margin: "8px 0" }}>
          <h2 style={{ margin: 0 }}>Messages</h2>
        </div>

        <div className="cards">
          {messages.map((m, i) => (
            <MessageCard
              key={m.id}
              m={m}
              board={board}
              isActive={m.id === board.active_message_id}
              first={i === 0}
              last={i === messages.length - 1}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
              onChanged={load}
            />
          ))}
        </div>

        <AddMessage board={board} onAdded={load} />
      </main>
    </>
  );
}

function BoardSettings({ board, onSaved }) {
  const [f, setF] = useState({
    name: board.name,
    cols: board.cols,
    rows: board.rows,
    gist_filename: board.gist_filename,
  });
  const [msg, setMsg] = useState("");
  async function save() {
    await api(`/api/signboards/${board.id}`, {
      method: "PATCH",
      body: { ...f, cols: Number(f.cols), rows: Number(f.rows) },
    });
    setMsg("Saved");
    setTimeout(() => setMsg(""), 1500);
    onSaved();
  }
  async function remove() {
    if (!confirm(`Delete sign board "${board.name}" and all its messages?`)) return;
    await api(`/api/signboards/${board.id}`, { method: "DELETE" });
    window.location.href = "/";
  }
  return (
    <div className="panel">
      <div className="row">
        <div className="grow">
          <label>Name</label>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div style={{ width: 90 }}>
          <label>Cols</label>
          <input type="number" value={f.cols} onChange={(e) => setF({ ...f, cols: e.target.value })} />
        </div>
        <div style={{ width: 90 }}>
          <label>Rows</label>
          <input type="number" value={f.rows} onChange={(e) => setF({ ...f, rows: e.target.value })} />
        </div>
        <div style={{ width: 160 }}>
          <label>Gist filename</label>
          <input
            value={f.gist_filename}
            onChange={(e) => setF({ ...f, gist_filename: e.target.value })}
          />
        </div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={save}>Save board</button>
        <button className="danger" onClick={remove}>
          Delete board
        </button>
        {msg && <span className="ok small">{msg}</span>}
      </div>
    </div>
  );
}

function MessageCard({ m, board, isActive, first, last, onMoveUp, onMoveDown, onChanged }) {
  const [editing, setEditing] = useState(false);
  const cfg = safeJson(m.config);

  async function toggleVisible() {
    await api(`/api/messages/${m.id}`, { method: "PATCH", body: { visible: !Number(m.visible) } });
    onChanged();
  }
  async function remove() {
    if (!confirm("Delete this message?")) return;
    await api(`/api/messages/${m.id}`, { method: "DELETE" });
    onChanged();
  }

  if (editing)
    return (
      <MessageEditor
        m={m}
        board={board}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onChanged();
        }}
      />
    );

  return (
    <div className={`msg ${Number(m.visible) ? "" : "hidden"} ${isActive ? "active" : ""}`}>
      <div className="row">
        <div className="grow">
          <strong>{m.title || "(untitled)"}</strong>{" "}
          {m.kind === "meetup" && <span className="badge meetup">meetup</span>}{" "}
          {isActive && <span className="badge active">on board</span>}
          <div className="muted small">
            {m.duration}s · {m.cols}×{m.rows}
            {m.kind === "meetup" && cfg.urlname ? ` · meetup.com/${cfg.urlname}` : ""}
          </div>
        </div>
        <button className="iconbtn" onClick={onMoveUp} disabled={first}>
          ↑
        </button>
        <button className="iconbtn" onClick={onMoveDown} disabled={last}>
          ↓
        </button>
        <button className="iconbtn" onClick={toggleVisible}>
          {Number(m.visible) ? "👁 visible" : "🚫 hidden"}
        </button>
        <button className="ghost" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button className="danger" onClick={remove}>
          ✕
        </button>
      </div>
    </div>
  );
}

function MessageEditor({ m, board, onClose, onSaved }) {
  const cfg = safeJson(m.config);
  const [f, setF] = useState({
    title: m.title,
    content: m.content,
    duration: m.duration,
    rows: m.rows,
    cols: m.cols,
    kind: m.kind,
    urlname: cfg.urlname || "hackerdojo",
    event_rows: cfg.event_rows || 5,
    header: cfg.header || "",
    footer: cfg.footer || "",
  });
  const [preview, setPreview] = useState("");
  const [err, setErr] = useState("");

  async function save() {
    setErr("");
    const body = {
      title: f.title,
      content: f.content,
      duration: Number(f.duration),
      rows: Number(f.rows),
      cols: Number(f.cols),
      kind: f.kind,
    };
    if (f.kind === "meetup") {
      body.config = {
        urlname: f.urlname,
        event_rows: Number(f.event_rows),
        header: f.header,
        footer: f.footer,
      };
    }
    try {
      await api(`/api/messages/${m.id}`, { method: "PATCH", body });
      onSaved();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function doPreview() {
    await save();
    const r = await api(`/api/messages/${m.id}/preview`);
    setPreview(r.text);
  }

  return (
    <div className="msg active">
      <div className="row">
        <div className="grow">
          <label>Title (label only — not shown on board)</label>
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </div>
        <div style={{ width: 120 }}>
          <label>Duration (s)</label>
          <input
            type="number"
            value={f.duration}
            onChange={(e) => setF({ ...f, duration: e.target.value })}
          />
        </div>
        <div style={{ width: 80 }}>
          <label>Cols</label>
          <input type="number" value={f.cols} onChange={(e) => setF({ ...f, cols: e.target.value })} />
        </div>
        <div style={{ width: 80 }}>
          <label>Rows</label>
          <input type="number" value={f.rows} onChange={(e) => setF({ ...f, rows: e.target.value })} />
        </div>
      </div>

      {f.kind === "text" ? (
        <div className="field" style={{ marginTop: 12 }}>
          <label>
            Message text ({f.cols} cols × {f.rows} rows — extra is clipped)
          </label>
          <textarea
            rows={Number(f.rows) + 1}
            style={{ fontFamily: "ui-monospace, monospace" }}
            value={f.content}
            onChange={(e) => setF({ ...f, content: e.target.value })}
          />
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="row">
            <div className="grow">
              <label>Meetup group urlname (meetup.com/&lt;urlname&gt;)</label>
              <input value={f.urlname} onChange={(e) => setF({ ...f, urlname: e.target.value })} />
            </div>
            <div style={{ width: 140 }}>
              <label>Event rows</label>
              <input
                type="number"
                value={f.event_rows}
                onChange={(e) => setF({ ...f, event_rows: e.target.value })}
              />
            </div>
          </div>
          <div className="field">
            <label>Header text (above the table)</label>
            <textarea
              rows={2}
              style={{ fontFamily: "ui-monospace, monospace" }}
              value={f.header}
              onChange={(e) => setF({ ...f, header: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Footer text (below the table)</label>
            <textarea
              rows={2}
              style={{ fontFamily: "ui-monospace, monospace" }}
              value={f.footer}
              onChange={(e) => setF({ ...f, footer: e.target.value })}
            />
          </div>
        </div>
      )}

      {err && <div className="error">{err}</div>}
      <div className="row">
        <button onClick={save}>Save</button>
        <button className="ghost" onClick={doPreview}>
          Save & preview
        </button>
        <button className="ghost" onClick={onClose}>
          Close
        </button>
      </div>

      {preview && (
        <div style={{ marginTop: 12 }}>
          <label>Preview (exactly what gets pushed to the gist)</label>
          <div className="board-preview">{preview}</div>
        </div>
      )}
    </div>
  );
}

function AddMessage({ board, onAdded }) {
  const [busy, setBusy] = useState(false);
  async function add(kind) {
    setBusy(true);
    try {
      await api(`/api/signboards/${board.id}/messages`, {
        method: "POST",
        body: {
          kind,
          title: kind === "meetup" ? "Meetup events" : "New message",
          rows: board.rows,
          cols: board.cols,
          visible: 1,
          duration: 60,
          config: kind === "meetup" ? { urlname: "hackerdojo", event_rows: 5, header: "", footer: "" } : undefined,
        },
      });
      onAdded();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="row" style={{ marginTop: 16 }}>
      <button onClick={() => add("text")} disabled={busy}>
        + Text message
      </button>
      <button className="ghost" onClick={() => add("meetup")} disabled={busy}>
        + Meetup events card
      </button>
    </div>
  );
}

function safeJson(s) {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}
