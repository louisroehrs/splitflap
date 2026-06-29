import { fetchMeetupEvents, renderEventTable } from "./meetup.js";

// Clamp a list of lines to the board geometry: each line truncated to `cols`,
// the whole block truncated to `rows`. We do NOT pad rows out — the board reads
// blank rows as blank, and trailing blanks are harmless.
function clamp(lines, rows, cols) {
  return lines.slice(0, rows).map((l) => l.slice(0, cols));
}

// Produce the final plain-text payload for a message, given its signboard's
// geometry. `text` messages use their content verbatim; `meetup` messages fetch
// live events and assemble header + table + footer.
export async function renderMessage(message, board) {
  const rows = board.rows;
  const cols = board.cols;

  if (message.kind === "meetup") {
    const cfg = safeJson(message.config);
    const header = (cfg.header || "").split("\n").filter((l) => l !== undefined);
    const footer = (cfg.footer || "").split("\n").filter((l) => l !== undefined);
    const eventRows = Number(cfg.event_rows) || 5;
    const urlname = cfg.urlname || "hackerdojo";

    let table;
    try {
      const events = await fetchMeetupEvents(urlname, Math.max(eventRows + 5, 20));
      table = renderEventTable(events, { cols, maxRows: eventRows });
    } catch (e) {
      table = ["MEETUP FETCH ERROR", String(e.message).slice(0, cols)];
    }

    const blank = header.length ? [""] : [];
    const blank2 = footer.length ? [""] : [];
    const lines = [...header, ...blank, ...table, ...blank2, ...footer];
    return clamp(lines, rows, cols).join("\n");
  }

  // Plain text message.
  const lines = (message.content || "").split("\n");
  return clamp(lines, rows, cols).join("\n");
}

function safeJson(s) {
  try {
    return JSON.parse(s || "{}");
  } catch {
    return {};
  }
}
