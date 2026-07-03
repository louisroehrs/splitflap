// tft_setup.h — TFT_eSPI configuration for the ESP32-2432S028R ("CYD",
// Cheap Yellow Display), 320x240 ILI9341.
//
// TFT_eSPI (v2.5.0+) auto-includes a file named EXACTLY "tft_setup.h" from the
// sketch folder — see TFT_eSPI.h: `#if __has_include(<tft_setup.h>)`. Because
// the sketch folder is on the include path for every compilation unit (the
// library's .cpp included), these defines actually reach TFT_eSPI. No library
// edits, and the config travels with this repo. Do NOT rename this file.

#define USER_SETUP_INFO "CYD ESP32-2432S028R ILI9341"

#define ILI9341_DRIVER            // the CYD's ILI9341 panel

// SPI pin map for the CYD's display.
#define TFT_MISO 12
#define TFT_MOSI 13
#define TFT_SCLK 14
#define TFT_CS   15
#define TFT_DC    2
#define TFT_RST  -1
#define TFT_BL   21               // backlight
#define TFT_BACKLIGHT_ON HIGH
#define TFT_WIDTH  320
#define TFT_HEIGHT 240

// Fonts used by the sketch (font 1 / GLCD is the cell glyph; font 2 the splash).
#define LOAD_GLCD
#define LOAD_FONT2
#define LOAD_GFXFF

#define SPI_FREQUENCY  55000000

// If red/blue are swapped, uncomment:
// #define TFT_RGB_ORDER TFT_BGR
// If the image is colour-inverted, uncomment one of:
// #define TFT_INVERSION_ON
// #define TFT_INVERSION_OFF
