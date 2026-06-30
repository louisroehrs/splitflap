// Ported from hackerdojo.app/api/events.js — fetch upcoming events from the
// Meetup GraphQL endpoint for a given group urlname.
export async function fetchMeetupEvents(urlname, first = 20) {
  // Meetup's public GraphQL endpoint is now /gql2; upcoming events come from
  // Group.events(status: ACTIVE), which returns only future/active events
  // sorted ascending by start time.
  const query = `
    query {
      groupByUrlname(urlname: "${urlname}") {
        events(first: ${first}, status: ACTIVE, sort: ASC) {
          edges {
            node {
              id
              title
              dateTime
              endTime
              eventUrl
              venue { name }
            }
          }
        }
      }
    }
  `;

  const response = await fetch("https://www.meetup.com/gql2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (splitflap-controller)",
    },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`Meetup: ${response.status}`);

  const data = await response.json();
  if (data.errors?.length) throw new Error(`Meetup: ${data.errors[0].message}`);
  const edges = data?.data?.groupByUrlname?.events?.edges ?? [];
  return edges.map((e) => e.node);
}

// The board can only display these flap characters (see splitflap_board.py).
// Uppercase first (the flaps are uppercase), then drop anything the board can't
// show — so "💥3D Printing💥" becomes "3D PRINTING".
const FLAPS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:'!?-/|\\_^@$&()#%+*=°";
const FLAP_SET = new Set(FLAPS);

export function sanitize(text) {
  return String(text)
    .toUpperCase()
    .split("")
    .filter((ch) => FLAP_SET.has(ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function fmtDate(iso) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function fmtTime(iso) {
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")}${ampm}`;
}

// Build the split-flap event table:
//
//   event                  date   time
//   --------------------- ----- -------
//   3D printing            6/29  6:30pm
//
// Column widths are derived from the board width (cols). The event-name column
// flexes to fill whatever is left after the fixed date (5) and time (7) columns.
export function renderEventTable(events, { cols = 32, maxRows = 5 } = {}) {
  const dateW = 5;
  const timeW = 7;
  const gap = 1;
  const nameW = Math.max(6, cols - dateW - timeW - gap * 2);

  const pad = (s, w) => String(s).slice(0, w).padEnd(w);
  const lines = [];
  lines.push(pad("event", nameW) + " " + pad("date", dateW) + " " + pad("time", timeW));
  lines.push("-".repeat(nameW) + " " + "-".repeat(dateW) + " " + "-".repeat(timeW));

  for (const ev of events.slice(0, maxRows)) {
    lines.push(
      pad(sanitize(ev.title), nameW) +
        " " +
        pad(fmtDate(ev.dateTime), dateW) +
        " " +
        pad(fmtTime(ev.dateTime), timeW)
    );
  }
  return lines;
}
