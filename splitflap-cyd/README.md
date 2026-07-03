# splitflap-cyd

A split-flap (airport / Solari-style) text board for the **CYD** — the "Cheap
Yellow Display", an **ESP32-2432S028R** with a 320×240 ILI9341 TFT.

It's the ESP32 sibling of the desktop builds in `../python`, `../pythonmac` and
`../splitflap-rs`. It fetches plain text from a URL (the same `../sign.txt`
format — one line per row) over WiFi and animates it onto a mechanical
split-flap grid: each cell rolls forward through the flap alphabet one
clattering flip at a time, with a horizontal seam and a folding card.

## Hardware

- ESP32-2432S028R ("CYD") — ILI9341 320×240, SPI.
- USB-C or micro-USB (varies by batch) for flashing/power.

## Software setup

1. Install the **Arduino IDE** and the **ESP32 board package** (Boards Manager →
   "esp32" by Espressif).
2. Install **TFT_eSPI** by Bodmer (Library Manager).
3. **Configure TFT_eSPI for the CYD** — nothing to do; see "Display config".

4. In the Arduino IDE select board **"ESP32 Dev Module"**.

## Display config

The CYD pin map lives in **`tft_setup.h`** next to the sketch, and it's picked
up automatically — **no library edits**.

TFT_eSPI (v2.5.0+) auto-includes a file named exactly `tft_setup.h` from the
sketch folder (`TFT_eSPI.h`: `#if __has_include(<tft_setup.h>)`). Because the
sketch folder is on the compiler include path for *every* translation unit —
the library's `TFT_eSPI.cpp` included — these defines actually reach the
library. The config also travels with this repo, so a clone just builds. **Do
not rename `tft_setup.h`** (the name is what triggers the mechanism), and make
sure you did *not* also edit the library's `User_Setup.h` to a conflicting
driver.

If the earlier "edit the library" attempt left changes behind, revert them: in
the TFT_eSPI library folder, `User_Setup_Select.h` should include
`<User_Setup.h>` (the stock default), and remove any `User_Setup_CYD.h` you
copied in.

Tuning (all in `tft_setup.h`): if the image is colour-inverted, uncomment
`#define TFT_INVERSION_ON` (or `_OFF`). If red/blue are swapped, uncomment
`#define TFT_RGB_ORDER TFT_BGR`.

## Configure the sketch

Edit the constants at the top of `splitflap-cyd.ino`:

```cpp
static const char* WIFI_SSID     = "YOUR_WIFI_SSID";
static const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
static const char* TEXT_URL      = "https://example.com/sign.txt";
```

Point `TEXT_URL` at wherever you host the text — a raw gist URL, GitHub Pages,
or a small server. It must return **plain text, one line per row** (blank lines
are preserved). Lines are clipped/padded to the grid.

Tunables:

- `COLS` / `ROWS` — grid size (default 26×8). Raise `COLS` for wider lines at
  the cost of legibility on the small panel.
- `REFRESH_INTERVAL_S` — how often to refetch (default 60 s).
- `FRAMES_PER_STEP` / `FRAME_MS` — flip speed / clatter.

## Flap alphabet

Matches the other builds:

```
 ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:"`'!?-/|\_^@$&()#%+*=~
```

(The desktop builds also include `°`; it's dropped here because it isn't a
single-byte character.)

## Flash & run

Flash from the Arduino IDE. On boot the board shows "Connecting WiFi…", then the
grid fills and flaps roll to the first fetched text. It refetches every
`REFRESH_INTERVAL_S` seconds and only animates cells whose target changed.
