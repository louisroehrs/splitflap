import { getSetting } from "./db.js";

const API = "https://api.github.com";

async function token() {
  const t = await getSetting("github_token");
  if (!t) throw new Error("No GitHub token configured. Add one in Settings.");
  return t;
}

function headers(t) {
  return {
    Authorization: `Bearer ${t}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// List the authenticated user's gists (lightweight summary for the picker).
export async function listGists() {
  const t = await token();
  const res = await fetch(`${API}/gists?per_page=100`, { headers: headers(t) });
  if (!res.ok) throw new Error(`GitHub: ${res.status} ${await res.text()}`);
  const gists = await res.json();
  return gists.map((g) => ({
    id: g.id,
    description: g.description || "(no description)",
    files: Object.keys(g.files || {}),
    html_url: g.html_url,
    raw_url: Object.values(g.files || {})[0]?.raw_url || null,
    updated_at: g.updated_at,
  }));
}

// Fetch a single gist's metadata + raw URLs.
export async function getGist(gistId) {
  const t = await token();
  const res = await fetch(`${API}/gists/${gistId}`, { headers: headers(t) });
  if (!res.ok) throw new Error(`GitHub: ${res.status} ${await res.text()}`);
  return res.json();
}

// Overwrite a single file inside a gist with new plain-text content.
export async function pushToGist(gistId, filename, content) {
  const t = await token();
  const res = await fetch(`${API}/gists/${gistId}`, {
    method: "PATCH",
    headers: { ...headers(t), "Content-Type": "application/json" },
    body: JSON.stringify({ files: { [filename]: { content } } }),
  });
  if (!res.ok) throw new Error(`GitHub: ${res.status} ${await res.text()}`);
  return res.json();
}

// Validate a token by hitting /user. Returns the login or throws.
export async function whoAmI(rawToken) {
  const res = await fetch(`${API}/user`, { headers: headers(rawToken) });
  if (!res.ok) throw new Error(`Invalid token (${res.status})`);
  const u = await res.json();
  return u.login;
}
