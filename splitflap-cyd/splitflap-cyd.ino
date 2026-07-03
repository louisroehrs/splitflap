
/*
 * splitflap-cyd.ino — Split-flap (airport / Solari-style) text board for the
 * "Cheap Yellow Display" (CYD): an ESP32-2432S028R with a 320x240 ILI9341 TFT.
 *
 * This is the ESP32 sibling of the desktop builds in ../python, ../pythonmac
 * and ../splitflap-rs. Like them it fetches a few lines of plain text from a
 * URL and animates them onto a mechanical split-flap grid: each cell rolls
 * forward through the flap alphabet one clattering flip at a time, with a
 * horizontal seam and a brief fold as each card lands.
 *
 * Because the ESP32 has no windowing system, the whole 320x240 panel is the
 * board. The text URL should return plain text, one line per row (exactly the
 * format of ../sign.txt). Lines are clipped/padded to the grid.
 *
 * ---------------------------------------------------------------------------
 * HARDWARE: ESP32-2432S028R ("CYD"). ILI9341 320x240, driven over SPI.
 *
 * DEPENDENCIES (install via Arduino Library Manager):
 *   - TFT_eSPI  by Bodmer
 *
 * TFT_eSPI MUST be configured for the CYD. The easiest way is to replace the
 * library's User_Setup.h (or select a setup in User_Setup_Select.h) with the
 * CYD pin map below. See README.md in this folder for the exact values — the
 * critical ones are:
 *     ILI9341_2_DRIVER, TFT_MISO 12, TFT_MOSI 13, TFT_SCLK 14,
 *     TFT_CS 15, TFT_DC 2, TFT_RST -1, TFT_BL 21, SPI_FREQUENCY 55000000
 *
 * BOARD: select "ESP32 Dev Module" in the Arduino IDE.
 * ---------------------------------------------------------------------------
 */

// NOTE: The TFT_eSPI display config lives in tft_setup.h next to this sketch.
// TFT_eSPI auto-includes a file named exactly "tft_setup.h" from the sketch
// folder, so no library edits are needed — see README.md, "Display config".
#include <WiFi.h>
#include <HTTPClient.h>
#include <TFT_eSPI.h>

// ------------------------- USER CONFIGURATION ------------------------------

// WiFi credentials.
static const char* WIFI_SSID     = "Hacker Dojo Free";
static const char* WIFI_PASSWORD = "hackerdojo";

// URL returning plain text, one line per row. This is the same sign.txt served
// by the other builds — point it at wherever you host it (a gist raw URL, a
// small server, GitHub Pages, etc).
static const char* TEXT_URL = "https://gist.githubusercontent.com/louisroehrs/003813d760ae8e0588dc53690c5c530f/raw/hackerdojosign.txt";

// Seconds between refetches of the text.
static const unsigned long REFRESH_INTERVAL_S = 60;

// Board geometry. On a 320x240 panel these give ~12px wide x 30px tall cells,
// which is about as small as stays legible. Raise COLS to fit wider lines at
// the cost of readability.
static const int COLS = 26;
static const int ROWS = 8;

// ------------------------- SPLIT-FLAP ALPHABET -----------------------------

// The order the flaps cycle through. The flip animation rolls FORWARD through
// this sequence, exactly like the physical drum. Must match the other builds.
static const char* FLAPS =
    " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:\"`'!?-/|\\_^@$&()#%+*=~";
static int NFLAPS;

// ------------------------- COLOURS (RGB565) --------------------------------

#define COL_BG     TFT_BLACK
#define COL_TILET  0x2104   // upper card, a touch lighter (31,31,31)
#define COL_TILEB  0x18E3   // lower card                    (22,22,22)
#define COL_TEXT   0xF79E   // near-white                   (242,242,242)
#define COL_SEAM   TFT_BLACK

// ------------------------- ANIMATION TUNING --------------------------------

// Frames spent per single flip. Lower = faster clatter.
static const int FRAMES_PER_STEP = 4;
// Target frame pacing (ms). The ESP32 redraws only animating cells.
static const int FRAME_MS = 12;

// ------------------------- INTERNAL STATE ----------------------------------

TFT_eSPI tft = TFT_eSPI();
TFT_eSprite cellSprite = TFT_eSprite(&tft);   // off-screen cell for flicker-free draw

int cellW, cellH, halfH;
int gridX, gridY;      // top-left of the grid, centred on the panel
int textSize;          // TFT_eSPI text size multiplier for the cell font

struct Cell {
  int cur;      // index into FLAPS currently shown
  int target;   // index we are rolling toward
  int frame;    // frame within the current single flip (0 = settled/landed)
  bool dirty;   // needs a redraw
};
Cell cells[ROWS][COLS];

unsigned long lastRefreshMs = 0;

// ------------------------- HELPERS -----------------------------------------

// Map an arbitrary character onto a flap index (uppercased; unknown -> space).
static int flapIndex(char ch) {
  if (ch >= 'a' && ch <= 'z') ch -= 32;   // toupper for ASCII
  for (int i = 0; i < NFLAPS; i++) {
    if (FLAPS[i] == ch) return i;
  }
  return 0;  // space
}

static bool cellAnimating(const Cell& c) {
  return c.cur != c.target || c.frame != 0;
}

// Draw one flap character into the cell sprite at a given card fold. The sprite
// is cellW x cellH. `topChar`/`botChar` let the two halves show different glyphs
// mid-flip. `foldTop` (0..1) squashes the top half downward (folding down);
// `foldBot` (0..1) is how far the incoming bottom card has dropped.
static void renderCell(char settledTop, char settledBot) {
  cellSprite.fillSprite(COL_BG);
  // Card bodies (leave a 1px gutter so cells read as separate tiles).
  cellSprite.fillRect(1, 1, cellW - 2, halfH - 1, COL_TILET);
  cellSprite.fillRect(1, halfH, cellW - 2, cellH - halfH - 1, COL_TILEB);

  cellSprite.setTextColor(COL_TEXT);
  cellSprite.setTextSize(textSize);
  cellSprite.setTextDatum(MC_DATUM);
  // The seam sits at halfH; centre the glyph on it.
  char buf[2] = { settledTop, 0 };
  cellSprite.drawString(buf, cellW / 2, halfH);
  // (settledBot is the same glyph when settled; the split is only visual.)
  (void)settledBot;

  // Seam line.
  cellSprite.drawFastHLine(1, halfH, cellW - 2, COL_SEAM);
}

// Draw a settled cell (no animation) directly to the panel.
static void drawSettled(int r, int c) {
  char ch = FLAPS[cells[r][c].cur];
  renderCell(ch, ch);
  cellSprite.pushSprite(gridX + c * cellW, gridY + r * cellH);
}

// Draw a mid-flip cell. The flip has two phases across FRAMES_PER_STEP frames:
//   phase 1: the current char's top card folds down toward the seam,
//   phase 2: the next char's bottom card drops from the seam downward.
static void drawFlipping(int r, int c) {
  Cell& cell = cells[r][c];
  char curCh  = FLAPS[cell.cur];
  char nextCh = FLAPS[(cell.cur + 1) % NFLAPS];
  float t = (float)cell.frame / FRAMES_PER_STEP;   // 0..1 across the whole flip

  cellSprite.fillSprite(COL_BG);
  cellSprite.setTextColor(COL_TEXT);
  cellSprite.setTextSize(textSize);
  cellSprite.setTextDatum(MC_DATUM);

  if (t < 0.5f) {
    // Background: next char's top already revealed above the seam, current
    // char's bottom still below it.
    // Top half -> next char.
    cellSprite.fillRect(1, 1, cellW - 2, halfH - 1, COL_TILET);
    // Bottom half -> current char.
    cellSprite.fillRect(1, halfH, cellW - 2, cellH - halfH - 1, COL_TILEB);
    { char b[2] = { nextCh, 0 }; cellSprite.drawString(b, cellW / 2, halfH); }
    // Folding card: current top, squashed toward the seam (bottom edge pinned).
    float p = t / 0.5f;                  // 0..1
    int sh = (int)(halfH * cosf(p * 1.5708f));
    if (sh < 1) sh = 1;
    // A darkening overlay makes the fold read as catching shadow.
    uint8_t shade = (uint8_t)(150 * p);
    cellSprite.fillRect(1, halfH - sh, cellW - 2, sh, COL_TILET);
    { char b[2] = { curCh, 0 };
      // Draw glyph then squash isn't feasible cheaply; approximate by centering
      // in the shrinking card.
      cellSprite.setTextDatum(MC_DATUM);
      cellSprite.drawString(b, cellW / 2, halfH - sh / 2); }
    if (shade) {
      // Cheap shadow: overlay black scanlines proportional to shade.
      for (int y = halfH - sh; y < halfH; y += (shade > 90 ? 2 : 3))
        cellSprite.drawFastHLine(1, y, cellW - 2, COL_BG);
    }
  } else {
    // Top settled to next char; incoming bottom card drops from the seam.
    cellSprite.fillRect(1, 1, cellW - 2, halfH - 1, COL_TILET);
    cellSprite.fillRect(1, halfH, cellW - 2, cellH - halfH - 1, COL_TILEB);
    { char b[2] = { nextCh, 0 }; cellSprite.drawString(b, cellW / 2, halfH); }
    float p = (t - 0.5f) / 0.5f;          // 0..1
    int sh = (int)((cellH - halfH) * sinf(p * 1.5708f));
    if (sh < 1) sh = 1;
    cellSprite.fillRect(1, halfH, cellW - 2, sh, COL_TILEB);
    { char b[2] = { nextCh, 0 };
      cellSprite.drawString(b, cellW / 2, halfH + sh / 2); }
    uint8_t shade = (uint8_t)(150 * (1.0f - p));
    if (shade) {
      for (int y = halfH; y < halfH + sh; y += (shade > 90 ? 2 : 3))
        cellSprite.drawFastHLine(1, y, cellW - 2, COL_BG);
    }
  }
  cellSprite.drawFastHLine(1, halfH, cellW - 2, COL_SEAM);
  cellSprite.pushSprite(gridX + c * cellW, gridY + r * cellH);
}

// Advance one animating cell by a single frame.
static void advance(Cell& c) {
  if (c.cur == c.target) { c.frame = 0; return; }
  c.frame++;
  if (c.frame >= FRAMES_PER_STEP) {
    c.cur = (c.cur + 1) % NFLAPS;
    c.frame = 0;
  }
}

// Set the board's target text. `lines` is the fetched text split on newlines.
static void setText(const String lines[], int nLines) {
  for (int r = 0; r < ROWS; r++) {
    String line = (r < nLines) ? lines[r] : String("");
    for (int col = 0; col < COLS; col++) {
      char ch = (col < (int)line.length()) ? line[col] : ' ';
      cells[r][col].target = flapIndex(ch);
      if (cellAnimating(cells[r][col])) cells[r][col].dirty = true;
    }
  }
}

// ------------------------- NETWORK -----------------------------------------

// Fetch the text URL and split it into up to ROWS lines. Returns line count.
// On failure, fills a two-line error message so the board keeps running.
static int fetchLines(String out[], int maxLines) {
  if (WiFi.status() != WL_CONNECTED) {
    out[0] = "WIFI DISCONNECTED";
    return 1;
  }
  HTTPClient http;
  // Cache-bust so intermediaries don't serve stale text.
  String url = String(TEXT_URL) + "?t=" + String(millis());
  http.begin(url);
  http.setUserAgent("splitflap-cyd/1.0");
  int code = http.GET();
  if (code != HTTP_CODE_OK) {
    out[0] = "FETCH ERROR";
    out[1] = String("HTTP ") + code;
    http.end();
    return 2;
  }
  String body = http.getString();
  http.end();

  int n = 0, start = 0;
  while (n < maxLines) {
    int nl = body.indexOf('\n', start);
    String line = (nl < 0) ? body.substring(start) : body.substring(start, nl);
    line.replace("\r", "");
    out[n++] = line;
    if (nl < 0) break;
    start = nl + 1;
  }
  return n;
}

// ------------------------- SETUP / LOOP ------------------------------------

void setup() {
  Serial.begin(115200);
  NFLAPS = strlen(FLAPS);

  tft.init();
  tft.setRotation(1);            // landscape 320x240
  tft.fillScreen(COL_BG);

  // Backlight on (some CYD variants gate it on TFT_BL / GPIO 21).
#ifdef TFT_BL
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);
#endif

  // Geometry: centre the grid on the panel.
  int sw = tft.width(), sh = tft.height();
  cellW = sw / COLS;
  cellH = sh / ROWS;
  halfH = cellH / 2;
  gridX = (sw - cellW * COLS) / 2;
  gridY = (sh - cellH * ROWS) / 2;

  // Pick the largest built-in font size that fits a glyph in the cell.
  // GLCD font 1 is 6x8 px; scale up while it still fits.
  textSize = 1;
  while ((6 * (textSize + 1)) < (cellW - 2) &&
         (8 * (textSize + 1)) < (halfH * 2 - 2)) {
    textSize++;
  }

  // Create the reusable cell sprite.
  cellSprite.setColorDepth(16);
  cellSprite.createSprite(cellW, cellH);
  cellSprite.setTextFont(1);

  // Init cells to blanks and paint the settled board.
  for (int r = 0; r < ROWS; r++)
    for (int c = 0; c < COLS; c++)
      cells[r][c] = { 0, 0, 0, false };
  for (int r = 0; r < ROWS; r++)
    for (int c = 0; c < COLS; c++)
      drawSettled(r, c);

  // Connect WiFi (non-blocking-ish: show a splash while we wait).
  tft.setTextColor(COL_TEXT, COL_BG);
  tft.setTextDatum(MC_DATUM);
  tft.drawString("Connecting WiFi...", sw / 2, sh / 2, 2);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  unsigned long t0 = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t0 < 20000) {
    delay(250);
  }
  // Repaint the board (clears the splash) before first flips roll in.
  tft.fillScreen(COL_BG);
  for (int r = 0; r < ROWS; r++)
    for (int c = 0; c < COLS; c++)
      drawSettled(r, c);

  // First fetch immediately.
  String lines[ROWS];
  int n = fetchLines(lines, ROWS);
  setText(lines, n);
  lastRefreshMs = millis();
}

void loop() {
  // Periodic refetch.
  if (millis() - lastRefreshMs >= REFRESH_INTERVAL_S * 1000UL) {
    String lines[ROWS];
    int n = fetchLines(lines, ROWS);
    setText(lines, n);
    lastRefreshMs = millis();
  }

  // Advance and redraw only animating cells.
  unsigned long frameStart = millis();
  bool any = false;
  for (int r = 0; r < ROWS; r++) {
    for (int c = 0; c < COLS; c++) {
      Cell& cell = cells[r][c];
      if (cellAnimating(cell)) {
        advance(cell);
        if (cellAnimating(cell)) {
          drawFlipping(r, c);
        } else {
          drawSettled(r, c);   // just landed
        }
        any = true;
      }
    }
  }

  // Pace the frame.
  unsigned long elapsed = millis() - frameStart;
  if (any && elapsed < (unsigned long)FRAME_MS) {
    delay(FRAME_MS - elapsed);
  } else if (!any) {
    delay(20);   // idle: nothing animating
  }
}
