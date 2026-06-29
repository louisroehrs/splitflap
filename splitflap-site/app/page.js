"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "./_lib/api.js";

export default function Dashboard() {
  const [authed, setAuthed] = useState(true);
  const [boards, setBoards] = useState(null);
  const [settings, setSettings] = useState({ hasToken: false, login: null });
  const [error, setError] = useState("");

  async function load() {
    try {
      const [s, b] = await Promise.all([api("/api/settings"), api("/api/signboards")]);
      setSettings(s);
      setBoards(b.signboards);
      setAuthed(true);
    } catch (e) {
      if (String(e.message).includes("unauthorized")) setAuthed(false);
      else setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  if (!authed) return <Login onDone={load} />;

  return (
    <>
      <header className="top">
        <h1>SPLIT-FLAP CONTROLLER</h1>
        <span className="muted small">
          {settings.login ? `gh: ${settings.login}` : "no GitHub token"}
        </span>
      </header>
      <main>
        {error && <div className="error">{error}</div>}
        <TokenPanel settings={settings} onSaved={load} />
        <NewBoard onCreated={load} />
        <h2>Sign boards</h2>
        {boards === null ? (
          <p className="muted">Loading…</p>
        ) : boards.length === 0 ? (
          <p className="muted">No sign boards yet. Create one above.</p>
        ) : (
          <div className="cards">
            {boards.map((b) => (
              <div className="panel" key={b.id}>
                <div className="row">
                  <div className="grow">
                    <strong>{b.name}</strong>{" "}
                    <span className="muted small">
                      {b.cols}×{b.rows} ·{" "}
                      {b.gist_id ? `gist ${b.gist_id.slice(0, 8)}…` : "no gist"}
                    </span>
                  </div>
                  <Link href={`/board/${b.id}`}>
                    <button className="ghost">Open →</button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function Login({ onDone }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  async function submit(e) {
    e.preventDefault();
    try {
      await api("/api/login", { method: "POST", body: { password: pw } });
      onDone();
    } catch {
      setErr("Wrong password");
    }
  }
  return (
    <main className="login-wrap">
      <div className="panel">
        <h2>Sign in</h2>
        <form onSubmit={submit}>
          <div className="field">
            <label>Password</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
          </div>
          {err && <div className="error">{err}</div>}
          <button>Enter</button>
        </form>
      </div>
    </main>
  );
}

function TokenPanel({ settings, onSaved }) {
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  async function save() {
    setErr("");
    setMsg("");
    try {
      const r = await api("/api/settings", { method: "POST", body: { token } });
      setMsg(`Saved — authenticated as ${r.login}`);
      setToken("");
      onSaved();
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <div className="panel">
      <strong>GitHub token</strong>{" "}
      {settings.hasToken ? (
        <span className="ok small">✓ set{settings.login ? ` (${settings.login})` : ""}</span>
      ) : (
        <span className="muted small">required to read/write gists</span>
      )}
      <div className="row" style={{ marginTop: 10 }}>
        <input
          className="grow"
          type="password"
          placeholder="ghp_… (needs 'gist' scope)"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button onClick={save} disabled={!token}>
          Save token
        </button>
      </div>
      {msg && <div className="ok small">{msg}</div>}
      {err && <div className="error">{err}</div>}
    </div>
  );
}

function NewBoard({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", cols: 32, rows: 6 });
  const [gists, setGists] = useState(null);
  const [gistId, setGistId] = useState("");
  const [filename, setFilename] = useState("sign.txt");
  const [err, setErr] = useState("");

  async function openForm() {
    setOpen(true);
    try {
      const r = await api("/api/gists");
      setGists(r.gists);
    } catch (e) {
      setErr(e.message);
    }
  }

  async function create() {
    setErr("");
    try {
      await api("/api/signboards", {
        method: "POST",
        body: {
          name: form.name,
          cols: Number(form.cols),
          rows: Number(form.rows),
          gist_id: gistId || null,
          gist_filename: filename,
        },
      });
      setOpen(false);
      setForm({ name: "", cols: 32, rows: 6 });
      setGistId("");
      onCreated();
    } catch (e) {
      setErr(e.message);
    }
  }

  if (!open)
    return (
      <button onClick={openForm} style={{ marginBottom: 18 }}>
        + New sign board
      </button>
    );

  return (
    <div className="panel">
      <strong>New sign board</strong>
      <div className="field" style={{ marginTop: 10 }}>
        <label>Name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="row">
        <div className="grow">
          <label>Columns</label>
          <input
            type="number"
            value={form.cols}
            onChange={(e) => setForm({ ...form, cols: e.target.value })}
          />
        </div>
        <div className="grow">
          <label>Rows</label>
          <input
            type="number"
            value={form.rows}
            onChange={(e) => setForm({ ...form, rows: e.target.value })}
          />
        </div>
      </div>
      <div className="field">
        <label>Gist (the board reads this gist's raw URL)</label>
        <select value={gistId} onChange={(e) => setGistId(e.target.value)}>
          <option value="">— select a gist —</option>
          {(gists || []).map((g) => (
            <option key={g.id} value={g.id}>
              {g.description} [{g.files.join(", ")}]
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label>Filename within gist</label>
        <input value={filename} onChange={(e) => setFilename(e.target.value)} />
      </div>
      {err && <div className="error">{err}</div>}
      <div className="row">
        <button onClick={create} disabled={!form.name}>
          Create
        </button>
        <button className="ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
