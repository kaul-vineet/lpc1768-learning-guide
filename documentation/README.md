# mbed LPC1768 and MSI-0315B Documentation Archive

This archive covers the two identified pieces of hardware:

| Hardware | Confirmed identifier | Documentation match |
|---|---|---|
| mbed Application Board | MSI-0315B, mbed-014.1, hardware Revision B | Exact |
| mbed NXP LPC1768 module | mbed-005.1 / LPC1768 companion module | Exact when `mbed-005.1` is printed on the module |

The Application Board's accelerometer is the **NXP/Freescale MMA7660FC**, not the
MMA7455. This is confirmed by the Revision-B schematic, official cookbook, pin
mapping, and surviving source libraries.

## Start here

1. [EdgeOps-86 MVP architecture, setup and acceptance checklist](EDGEOPS-86-MVP.md)
2. [Validated IoT-to-LLM engineering learnings](EDGEOPS-86-VALIDATED-LEARNINGS.md)
3. [Official Application Board cookbook (archived)](archived-guides/mbed-application-board-cookbook.html)
4. [Application Board Revision-B schematic](exact-hardware/mbed-014.1-rev-b-application-board-schematic.pdf)
5. [LPC1768 module schematic](exact-hardware/mbed-005.1-lpc1768-module-schematic.pdf)
6. [LPC17xx user manual UM10360](lpc1768/UM10360-LPC17xx-user-manual.pdf)
7. [LPC1769/68 family datasheet](lpc1768/LPC1769-63-family-datasheet-rev9.7.pdf)
8. [Modernized Application Board examples](examples/MBED-Application-board-examples/)
9. [Archived LPC1768 platform page](archived-module-guides/mbed-LPC1768-platform.html)
10. [Verified university, project, code and video resources](VERIFIED-RESOURCES.md)

## Directory map

| Directory | Contents |
|---|---|
| `exact-hardware` | Schematics matching mbed-014.1 Revision B and mbed-005.1 |
| `lpc1768` | LPC1768 MCU datasheet and complete peripheral/register manual |
| `components` | LCD, accelerometer, and temperature-sensor datasheets |
| `archived-guides` | Saved Wayback Machine copies of retired mbed pages |
| `archived-module-guides` | LPC1768 platform, setup, interface, HDK and firmware pages |
| `archived-libraries` | Saved pages for original peripheral and network libraries |
| `archived-examples` | Saved pages for original Application Board demonstrations |
| `firmware` | Recovered legacy interface-firmware images; do not install without review |
| `product-pages` | Saved distributor pages identifying the board and features |
| `examples` | Shallow Git clones of surviving public examples and design files |

## Exact hardware documents

| Local document | Original/public source | Status |
|---|---|---|
| [mbed-014.1 Revision-B Application Board schematic](exact-hardware/mbed-014.1-rev-b-application-board-schematic.pdf) | [Archived mbed copy](https://web.archive.org/web/20130220003612id_/http://mbed.org/media/uploads/chris/mbed-014.1_b.pdf) | Verified three-page Revision-B schematic |
| [mbed-005.1 LPC1768 module schematic](exact-hardware/mbed-005.1-lpc1768-module-schematic.pdf) | [Archived mbed copy](https://web.archive.org/web/20260608121737/https://os.mbed.com/media/uploads/chris/mbed-005.1.pdf) | Downloaded and PDF-validated |
| [Application Board cookbook](archived-guides/mbed-application-board-cookbook.html) | [Archived official page](https://web.archive.org/web/20260608054705/https://os.mbed.com/cookbook/mbed-application-board) | Downloaded HTML |

The cookbook is the primary board-level guide. It contains the peripheral
inventory, pin assignments, part numbers, and links or code snippets for the
original demonstration programs.

## LPC1768 reference documents

| Local document | Purpose | Source |
|---|---|---|
| [UM10360 LPC17xx user manual](lpc1768/UM10360-LPC17xx-user-manual.pdf) | Complete memory map, registers, GPIO, interrupts, timers, ADC, DAC, PWM, UART, I2C, SPI/SSP, CAN, USB and Ethernet | Archived official NXP PDF |
| [LPC1769/68/67/66/65/64/63 datasheet Rev. 9.7](lpc1768/LPC1769-63-family-datasheet-rev9.7.pdf) | Pin functions, electrical limits, package data and peripheral summary | [Farnell NXP document mirror](https://www.farnell.com/datasheets/2287630.pdf) |
| [mbed-005.1 module schematic](exact-hardware/mbed-005.1-lpc1768-module-schematic.pdf) | Module power, LPC1768, interface MCU, USB and 40-pin connections | Archived official mbed PDF |
| [KiCad reconstruction/design files](examples/MBED-LPC-1768-KiCAD/) | Searchable electronic design files for the original module | [jrv/MBED-LPC-1768](https://github.com/jrv/MBED-LPC-1768) |

## Application Board component documents and pin map

| Function | Actual component | LPC1768 connection | Local document |
|---|---|---|---|
| 128x32 graphical LCD | Newhaven NHD-C12832A1Z-FSW-FBW-3V3, ST7565R controller | MOSI `p5`, SCK `p7`, reset `p6`, A0 `p8`, CS `p11` | [LCD datasheet](components/NHD-C12832A1Z-LCD-datasheet.pdf) |
| 3-axis accelerometer | NXP/Freescale MMA7660FC | I2C SCL `p27`, SDA `p28`; 8-bit address `0x98` | [MMA7660FC datasheet](components/MMA7660FC-accelerometer-datasheet.pdf) |
| Temperature sensor | NXP LM75B | I2C SCL `p27`, SDA `p28`; 8-bit address `0x90` | [LM75B datasheet](components/LM75B-temperature-sensor-datasheet.pdf) |
| Joystick | ALPS SKRHADE010 | Down `p12`, left `p13`, center `p14`, up `p15`, right `p16` | Application Board cookbook and schematic |
| Potentiometer 1 | Iskra PNZ10ZA 10k | Analog input `p19` | Application Board schematic |
| Potentiometer 2 | Iskra PNZ10ZA 10k | Analog input `p20` | Application Board schematic |
| Analog/audio input | CUI SJ-3523-SMT jack circuit | Analog input `p17` | Application Board schematic |
| Analog/audio output | CUI SJ-3523-SMT jack circuit | DAC output `p18` | Application Board schematic |
| Servo headers | Two R/C servo outputs | PWM `p21` and `p22` | Application Board schematic |
| RGB LED | Cree CLV1A-FKB, common anode | PWM red `p23`, green `p24`, blue `p25` | Application Board schematic |
| Speaker | Multicomp MCSMT-8030B-3717 | PWM `p26` | Application Board schematic |
| Wireless socket | XBee/RN-XV footprint | UART `p9` and `p10` | Application Board schematic |
| Ethernet | RJ45/magnetics connected to LPC1768 Ethernet interface | Dedicated Ethernet pins | Application Board and module schematics |
| USB host/device | USB-A and mini-USB connectors | Dedicated LPC1768 USB pins | Application Board and module schematics |

The `0x98` and `0x90` values above are the legacy mbed 8-bit I2C address form.
When an API expects a 7-bit address, use `0x4C` for the MMA7660FC and `0x48` for
the LM75B.

## Archived official guides

| Local guide | Coverage | Original status |
|---|---|---|
| [Application Board cookbook](archived-guides/mbed-application-board-cookbook.html) | Whole-board guide and original demonstrations | Official mbed page; retired |
| [mbed Hardware handbook](archived-guides/mbed-hardware-handbook.html) | LPC1768 module programming and pin-oriented introduction | Official mbed page; retired |
| [USBHostMSD handbook](archived-guides/USBHostMSD-handbook.html) | USB flash-drive host example and hardware notes | Official mbed page; retired |
| [WiflyInterface cookbook](archived-guides/WiflyInterface-cookbook.html) | RN-XV/WiFly API and wiring reference | Official mbed page; retired |
| [LPC1768 platform page](archived-module-guides/mbed-LPC1768-platform.html) | Features, pinout and first-program information | Official mbed page; retired |
| [LPC1768 Getting Started](archived-module-guides/LPC1768-getting-started.html) | Connection, registration and first-program walkthrough | Official mbed page; retired |
| [mbed interface architecture](archived-module-guides/mbed-interface-architecture.html) | USB drive, serial, target-programming and semihosting design | Official mbed page; retired |
| [LPC1768 interface firmware guide](archived-module-guides/LPC1768-interface-firmware-guide.html) | Firmware-update procedure and historical changelog | Official mbed page; retired |
| [mbed HDK](archived-module-guides/mbed-HDK.html) | Historical hardware-development-kit reference | Official mbed page; retired |

Arm retired the original mbed website and online services in July 2026. These
HTML files are local Wayback captures and may contain links that no longer work.
Their code primarily targets legacy Mbed 2 APIs and should be treated as
historical reference rather than copied into a new project without review.

## Archived original libraries and example pages

The `archived-libraries` directory contains saved Wayback pages for C12832,
C12832_lcd, MMA7660, LM75B, two WiflyInterface copies, USBHost, and the LM75B
component page. The `archived-examples` directory contains the surviving
repository or notebook pages for the original LCD, joystick, AnalogOut,
speaker, servo, RGB, LM75B, WiFly WebSocket, MMA7660, USB mouse, Kill the Bit,
ED Maker, and Waveplayer demonstrations.

An archived source page does not necessarily include a complete downloadable
Mercurial repository. It does, however, preserve provenance, revision metadata,
descriptions, dependency links, and sometimes browsable source. Prefer the
downloaded GitHub repositories for code that must build today.

## Downloaded example repositories

| Local repository | What it contains | Expected usability |
|---|---|---|
| [MBED-Application-board-examples](examples/MBED-Application-board-examples/) | LCD, speaker, bubble level, USB mouse and USB keyboard examples for the board | Best starting point; PlatformIO/Mbed OS-era code |
| [wakaama-mbed-application-board](examples/wakaama-mbed-application-board/) | C12832, LM75B, MMA7660 and Ethernet libraries in an Application Board project | Useful source reference; legacy Mbed |
| [C12832A1Z](examples/C12832A1Z/) | Improved driver for the exact LCD family | Useful, but repository is archived |
| [Str_Project_Part2](examples/Str_Project_Part2/) | C12832, LM75B, MMA7660 and FreeRTOS-derived game code | Useful library/source recovery |
| [MMA7660](examples/MMA7660/) | Standalone MMA7660 driver | Useful source reference |
| [mbed-servo](examples/mbed-servo/) | Original generic mbed servo library | Requires `p21`/`p22` configuration |
| [ntp-client](examples/ntp-client/) | Arm Mbed Ethernet/NTP example | Modern relative to Mbed 2, but Arm Mbed is EOL |
| [mbed-ce-ntp-client](examples/mbed-ce-ntp-client/) | Mbed CE Ethernet/NTP example | Current community path; requires integration |
| [MBED-LPC-1768-KiCAD](examples/MBED-LPC-1768-KiCAD/) | Searchable module design files | Hardware reference, not firmware |

Each repository retains its own upstream Git history, license, and origin URL.
They were downloaded as shallow clones, so only the current upstream revision is
stored locally.

## Original cookbook demonstrations

| Demonstration | Board features | Recovery status |
|---|---|---|
| `app-board-LCD` | C12832 LCD | Modern replacements downloaded |
| `app-board-Joystick` | Joystick and LEDs | Simple GPIO example recoverable from cookbook |
| `kill_the_bit` | Joystick, LEDs and speaker | FreeRTOS-derived variant downloaded |
| `appbd_edmaker` | Joystick, LCD and speaker | Archived repository page saved; no GitHub mirror |
| `app-board-AnalogOut` | Potentiometer and audio/DAC | Simple example recoverable from cookbook |
| `AppBoard_Waveplayer` | USB storage and audio output | Repository and notebook pages saved; standalone `wave_player` library export remains unavailable |
| `app-board-Speaker` | Speaker PWM and joystick | Modern replacement downloaded |
| `MMA7660_HelloWorld` | Accelerometer and PWM LEDs | Driver copies downloaded |
| `app-board-Bubble-Level` | Accelerometer and LCD | Modern replacement downloaded |
| `app-board-Servo` | Potentiometers and servo headers | Generic servo library downloaded; external servos are required |
| `app-board-RGB` | RGB LED | Logic recoverable from cookbook/schematic |
| `USBMouse_HelloWorld` | USB device | Modern replacement downloaded |
| `app-board-LM75B` | Temperature sensor and LCD | Driver/source copies downloaded |
| Ethernet NTP/HTTP/WebSocket demos | Ethernet | Modern NTP examples downloaded; retired network services require replacement |
| WiFly WebSocket demo | RN-XV socket, sensors | Demo and library pages archived; original backend is unavailable and no GitHub mirror was found |
| USB flash-disk logger | USB host and potentiometers | Historical guide downloaded; original beta library is unavailable |

## Saved product-identification pages

| Local copy | Live source |
|---|---|
| [Pololu product page](product-pages/pololu-2155-application-board.html) | https://www.pololu.com/product/2155 |
| [Adafruit product page](product-pages/adafruit-1323-application-board.html) | https://www.adafruit.com/product/1323 |
| [Electrokit product page](product-pages/electrokit-application-board.html) | https://www.electrokit.com/en/mbed-application-board |

## Development environment status

The original Arm Mbed platform, website, online compiler, and official Mbed OS
maintenance have ended. Legacy code remains valuable for learning the hardware,
but new work should use a local toolchain.

| Toolchain | August 2026 assessment |
|---|---|
| Mbed CE | Closest maintained continuation; LPC1768 target is supported |
| PlatformIO `nxplpc/lpc1768/mbed` | Practical offline build and drag-and-drop upload path using its vendored Mbed framework |
| Mbed Studio 1.5 | Last official desktop release; useful for legacy projects but no longer maintained |
| Keil MDK v6 Community Edition | Viable local compiler/IDE with the LPC1700 device pack |
| Bare-metal CMSIS, FreeRTOS or MCUXpresso | Viable but requires more startup, driver and build-system work |

Application Board support is a set of peripheral drivers and pin assignments
rather than a dedicated target, so some porting is expected. Producing a `.bin`
file and dragging it onto the module's USB drive remains independent of the
retired mbed website.

The original module does not provide modern DAPLink/CMSIS-DAP debugging.
Community documentation recommends legacy OpenOCD 0.10 through 0.12 for its
onboard debug path; newer OpenOCD and pyOCD combinations have known problems.
This restriction affects debugging, not ordinary drag-and-drop programming.

Useful current projects that are indexed but not copied because of their size:

- Mbed CE: https://github.com/mbed-ce/mbed-os
- Frozen official Mbed OS source: https://github.com/ARMmbed/mbed-os
- Arm Mbed sunset organization page: https://github.com/ArmMbed

## Interface firmware

Two historical interface-firmware images were recovered into `firmware`:
revision 141212 and revision 21164. They are preserved for research and recovery,
not presented as automatic updates. Confirm the module identity, current
firmware, update instructions, file hash, and power stability before attempting
an installation. The normal firmware-development workflow does not require an
interface-firmware update.

The module uses a separate interface processor and external serial flash to
provide the USB mass-storage drive and virtual serial port. Public sources
disagree about the exact interface-processor part number, so the archive does
not assert one without confirmation from the schematic or chip marking.

## Known documentation gaps

No public Revision-A Application Board schematic was found. WiflyInterface
repository pages survive in the Wayback Machine, but no verified GitHub mirror
was found and some archived content is incomplete. Several named Mbed 2
repository exports and the standalone historical `wave_player` library remain
unavailable. The old `sockets.mbed.org` service is gone, so its WebSocket
examples cannot work unchanged. Some component-level datasheets for commodity
connectors, potentiometers, speaker and audio jacks were not publicly
recoverable, but their connections and part numbers remain documented in the
exact board schematic.

This is a comprehensive verified public-source archive, not a guarantee that
every file ever published for this discontinued hardware still exists online.
