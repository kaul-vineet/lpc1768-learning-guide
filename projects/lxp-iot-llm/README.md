# Physical Signals to AI Guidance

This hackathon MVP demonstrates IoT-to-LLM decision support using a physical
LPC1768 edge decision, Azure IoT delivery, and evidence-grounded Azure AI
Foundry interpretation.

> The device senses, the edge decides, IoT delivers, Foundry explains, and the
> human acts.

```text
p19 load + p20 cooling + joystick mode + LM75B temperature
                         |
                         v
              LPC1768 deterministic risk
                         |
                    Ethernet HTTP
                         |
                         v
        Windows gateway -> dashboard / IoT Hub / Foundry
```

## Physical controls

| Hardware | Meaning |
|---|---|
| Left potentiometer `p19` | Simulated equipment load |
| Right potentiometer `p20` | Simulated cooling capacity |
| Joystick centre `p14` | NORMAL mode |
| Joystick up `p15` | BOOST mode |
| Joystick down `p12` | MAINTENANCE mode |
| LM75B on I2C `p28/p27` | Supporting ambient temperature |
| C12832 LCD on SPI | Local edge dashboard output |

Joystick left and right are intentionally unused.

On the tested Application Board, the joystick is active-high. Firmware uses
`PullDown`, treats `1` as pressed, polls every 20 ms in a dedicated thread, and
latches the selected mode.

The two ADC channels use a discarded settling read, a 100 microsecond delay,
16-sample averaging, and a one-point deadband. This prevents channel switching
and small electrical variations from moving both displayed values.

## Deterministic rules

```text
headroom = cooling - load

CRITICAL: load >= 85 and headroom < 0
WARNING:  load >= 70 or headroom < 0
NORMAL:   otherwise
```

Temperature and operating mode provide context. They do not override the
deterministic risk.

## Network

The validated LAN configuration is:

```text
Windows gateway: 192.168.29.226
LPC1768 board:    192.168.29.240
Netmask:          255.255.255.0
Router:           192.168.29.1
HTTP port:        8080
```

Change the constants in `src/main.cpp` for another LAN. USB programs and powers
the LPC1768; the Application Board RJ45 connector carries telemetry. Native USB
CDC is not used because the tested LPC1768/Mbed path stalled after its first
message.

## Build and flash firmware

Use PlatformIO with Python 3.11:

```powershell
C:\Users\vineetkaul\.platformio-py311\Scripts\platformio.exe run
```

Copy `.pio\build\lpc1768\firmware.bin` to the mounted `MBED` drive, connect
Ethernet, and press reset.

The board posts:

```json
{
  "deviceId": "lpc1768-01",
  "loadPercent": 82,
  "coolingPercent": 35,
  "mode": "normal",
  "temperatureC": 27.4,
  "temperatureValid": true,
  "state": "warning",
  "sequence": 84
}
```

If LM75B cannot be read, the board sends `temperatureC: null` and
`temperatureValid: false` instead of fabricating a value.

## On-board LCD

The 128x32 LCD remains local-only and refreshes independently of slow TCP
connections:

- NORMAL alternates every two seconds between load/cooling bars and
  mode/temperature context.
- WARNING overrides the normal pages with load, cooling, deficit duration, and
  mode.
- CRITICAL uses the same alert page with a blinking inverted display.
- `TX:OK` means the board sent the request to the Windows gateway. It does not
  claim IoT Hub acceptance or Foundry completion.

The full LLM explanation remains on the browser dashboard.

## Configure and run the gateway

Copy `.env.example` to `.env`, then set:

```text
IOT_HUB_DEVICE_CONNECTION_STRING=
FOUNDRY_API_KEY=
```

Never commit `.env`.

```powershell
npm install
npm run build
npm start
```

Open `http://localhost:8080`.

## What the dashboard shows

- Deterministic NORMAL, WARNING, or CRITICAL risk
- Load and cooling gauges
- NORMAL, BOOST, or MAINTENANCE mode
- Capacity headroom or deficit
- Load, cooling, and temperature trends
- Duration and pattern of a capacity deficit
- LM75B temperature or explicit sensor error
- Two-line load-versus-cooling chart
- IoT Hub delivery and incident timeline
- Structured Foundry assessment

The gateway stores the latest 120 samples in memory only. After eight seconds
without physical telemetry, the board becomes offline and the clearly labelled
simulator resumes. Simulator cloud traffic is disabled by default.

## Foundry prompt contract

Prompt version `edgeops-multicontrol-v1` defines every domain term, treats
gateway risk as authoritative, prohibits invented measurements and device
commands, and requires:

```json
{
  "assessment": "",
  "contributingFactors": [""],
  "recommendedAction": "",
  "expectedRecovery": "",
  "limitation": ""
}
```

Foundry is requested for state transitions, recovery, and mode changes during an
active incident. It does not classify risk.

## Test without hardware

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://localhost:8080/api/telemetry `
  -ContentType application/json `
  -Body '{"deviceId":"test","loadPercent":82,"coolingPercent":35,"mode":"normal","temperatureC":27.4,"temperatureValid":true,"state":"warning","sequence":1}'
```

Valid telemetry returns HTTP 202. Invalid ranges, modes, temperature validity,
or deterministic state return HTTP 400.

## Two-minute demo

1. Set load below cooling and show positive headroom.
2. Raise `p19` above `p20` and show a capacity deficit.
3. Hold the deficit until it becomes sustained.
4. Push joystick up for BOOST.
5. Raise `p20` and show the deficit shrinking.
6. Lower load below 70 and show recovery to NORMAL.
7. Point to the Foundry assessment, contributing factors, recovery evidence,
   and limitation.

Temperature is supporting evidence and may be warmed gently by hand if a visible
change is useful. The core demonstration must not depend on rapid temperature
movement.

## Current validation

- [x] Multi-control and C12832 firmware builds without warnings.
- [x] Gateway and dashboard build.
- [x] `p19` and `p20` are physically validated and stable.
- [x] Active-high joystick input and NORMAL/BOOST/MAINTENANCE latching are
  physically validated.
- [x] LM75B temperature is physically validated.
- [x] LCD orientation, contrast, pages, alert override, blink, and TX status are
  physically validated.
- [x] Physical NORMAL, WARNING, CRITICAL, partial recovery, and full recovery
  are validated.
- [x] IoT Hub delivery and strict Foundry WARNING, CRITICAL, BOOST, and recovery
  output are validated.
- [x] HTTP accepts valid telemetry and rejects invalid state or sensor data.

The root learning website's final capstone contains the physical results,
implementation constraints, incident values, and reusable design conclusions.

No database, prediction, authentication, extra sensors, speaker,
cloud-to-device control, or arbitrary AI chat is included.
