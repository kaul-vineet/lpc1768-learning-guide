# EdgeOps-86 MVP Tutorial

## What this demonstration proves

EdgeOps-86 connects one physical control on the original mbed hardware to a
modern Azure AI workflow. Turning the Application Board potentiometer `p19`
changes a simulated equipment-load value. The LPC1768 classifies that value
locally, sends it to a Windows gateway over Ethernet, and the gateway presents
the signal in a browser, forwards selected telemetry to Azure IoT Hub, and asks
Azure AI Foundry for a bounded incident explanation.

The important design boundary is:

> The LPC1768 decides the machine state. The LLM explains the observed incident.

The LLM is not part of the safety loop and cannot control or acknowledge the
device.

## Hardware and software

The tutorial uses only:

- mbed NXP LPC1768 module, hardware version mbed-005.1
- mbed Application Board, MSI-0315B / mbed-014.1 Revision B
- Application Board potentiometer 1, connected to LPC1768 pin `p19`
- Application Board RJ45 Ethernet connector
- USB cable connected to the narrow LPC1768 module for programming and power
- Windows PC with Node.js, npm, and PlatformIO
- Azure IoT Hub device identity
- Azure AI Foundry chat-completions deployment

No `p20`, joystick, temperature sensor, accelerometer, LCD, RGB LED, speaker,
database, cloud-to-device command, or automated control is part of this MVP.

## Architecture

```text
             deterministic edge boundary
             ---------------------------
p19 knob --> LPC1768 ADC --> threshold classification
                                |
                                | JSON over Ethernet HTTP
                                v
                         Windows Node gateway
                          /        |        \
                         /         |         \
              React dashboard  Azure IoT Hub  Azure AI Foundry
                   SSE          rate-limited   incident-only
```

The Windows gateway is deliberately responsible for TLS and Azure credentials.
The microcontroller contains no cloud secret.

## Deterministic state model

The firmware converts the ADC reading to an integer percentage and applies:

| Load | State | Meaning in the demo |
|---:|---|---|
| 0-69% | `normal` | Simulated equipment is within the operating limit |
| 70-84% | `warning` | Simulated load is approaching the limit |
| 85-100% | `critical` | Simulated load limit is exceeded |

These thresholds are compiled into `projects/lxp-iot-llm/src/main.cpp`. The
gateway validates that the reported state matches the reported load, so malformed
or inconsistent telemetry is rejected instead of displayed as valid data.

## Why Ethernet HTTP is used

The LPC1768 native USB device can enumerate on Windows as
`VID_1F00/PID_2012`, but the tested Mbed OS 6 USB CDC path stalled after its
first message. This behavior is consistent with the known LPC17xx USB HAL
regression documented in ARMmbed/mbed-os#9002.

The reliable MVP transport is therefore the Application Board Ethernet PHY and
a small HTTP request:

```http
POST /api/telemetry HTTP/1.1
Content-Type: application/json

{"deviceId":"lpc1768-01","loadPercent":72,"state":"warning","sequence":83}
```

UDP support remains available in the gateway for compatibility experiments, but
the validated physical board path is HTTP.

## Network configuration

The validated network used a Windows PC on Wi-Fi and the board connected by
Ethernet to a TP-Link range extender. A direct PC Ethernet connection is not
required; both devices only need IP reachability through the same LAN.

```text
Windows gateway: 192.168.29.226
Board:           192.168.29.240
Netmask:         255.255.255.0
Router:          192.168.29.1
Gateway port:    8080
Optional UDP:    41234
```

The board appeared as a wired client named `ANONYMOUS` with MAC address
`00-02-F7-F1-7E-71`. The application does not depend on that client name.

If the LAN uses different addresses, edit these constants in
`projects/lxp-iot-llm/src/main.cpp`:

```cpp
constexpr char gatewayIp[] = "192.168.29.226";
constexpr uint16_t gatewayPort = 8080;
constexpr char boardIp[] = "192.168.29.240";
constexpr char netmask[] = "255.255.255.0";
constexpr char routerIp[] = "192.168.29.1";
```

Choose an unused board address in the LAN subnet. Rebuild and reflash after any
firmware network change.

## Step 1: Build the firmware

The legacy PlatformIO Mbed integration needs Python 3.11 because it imports
Python modules removed in Python 3.12.

From `projects/lxp-iot-llm`:

```powershell
C:\Users\vineetkaul\.platformio-py311\Scripts\platformio.exe run
```

The expected artifact is:

```text
.pio\build\lpc1768\firmware.bin
```

## Step 2: Flash and connect the board

1. Connect the USB cable to the narrow LPC1768 module.
2. Confirm that Windows mounts the `MBED` drive.
3. Copy `.pio\build\lpc1768\firmware.bin` to `MBED`.
4. Wait for the copy to complete.
5. Keep this USB cable connected to power the module and Application Board.
6. Connect the Application Board RJ45 socket to the router or extender.
7. Press the LPC1768 reset button.

The firmware repeatedly:

1. Reads only `p19`.
2. Converts the ADC value to 0-100%.
3. Assigns `normal`, `warning`, or `critical`.
4. Increments a sequence number.
5. Opens a TCP socket and posts JSON to the gateway.
6. Toggles LED1 after a successful send.

## Step 3: Configure the gateway

Copy `.env.example` to `.env`:

```powershell
Copy-Item .env.example .env
```

Set the secrets in `.env`:

```text
IOT_HUB_DEVICE_CONNECTION_STRING=
FOUNDRY_API_KEY=
```

The complete non-secret configuration is:

```text
PORT=8080
DEVICE_ID=lpc1768-01
DEVICE_TRANSPORT=ethernet
UDP_PORT=41234
SERIAL_PORT=auto
SERIAL_BAUD=115200
ENABLE_SIMULATOR=true
ENABLE_SIMULATOR_CLOUD=false
CLOUD_INTERVAL_MS=30000
FOUNDRY_ENDPOINT=https://stell-foundry.openai.azure.com
FOUNDRY_DEPLOYMENT=gpt-5
FOUNDRY_API_VERSION=2024-10-21
```

The validated Azure resources were:

```text
IoT Hub:          stell-iot-hub.azure-devices.net
Device identity:  lpc1768-01
Foundry account:  stell-foundry
Foundry project:  proj-default
Deployment:       gpt-5
```

Never commit `.env`. The repository ignores it.

## Step 4: Build and run the dashboard

From `projects/lxp-iot-llm`:

```powershell
npm install
npm run build
npm start
```

Open:

```text
http://localhost:8080
```

Useful endpoints:

```text
GET  /api/health       compact health and link state
GET  /api/status       complete dashboard state
POST /api/telemetry    physical-board telemetry
GET  /events           server-sent event stream
```

The server listens on all local interfaces. Existing Windows inbound rules for
Node must allow TCP port 8080 on the active network profile.

## Step 5: Understand the dashboard

| Display | Interpretation |
|---|---|
| BOARD ready | A valid physical message arrived within the last eight seconds |
| BOARD offline | No recent physical message |
| SIMULATOR INPUT ACTIVE | The PC simulator is supplying clearly labelled local data |
| IOT HUB ready | The Azure device client is connected |
| FOUNDRY ready | Foundry configuration is present and the last request succeeded |
| CLOUD TX | Count of messages accepted by IoT Hub |
| MACHINE STATE | Deterministic state reported by the board |
| LIVE SIGNAL | Most recent 120 samples |
| INCIDENT TIMELINE | State transitions, not every telemetry sample |

The dashboard is served by the PC. Unplugging the board does not stop the
dashboard. After eight seconds without a board message, the board link becomes
offline and the simulator resumes.

## Step 6: Validate the physical path

1. Start the gateway before resetting the board.
2. Open `http://localhost:8080/api/health`.
3. Reset the board.
4. Confirm the gateway reports board telemetry received over HTTP.
5. Confirm **BOARD** changes to ready and the simulator banner disappears.
6. Turn the left-hand `p19` knob and confirm the load gauge changes.
7. Hold the value below 70 and confirm `normal`.
8. Move through 70-84 and confirm `warning`.
9. Observe an immediate IoT Hub state-change message.
10. Observe a Foundry explanation attached to the warning incident.
11. Optionally move to 85 or higher and confirm `critical`.

The physical tests completed for this MVP observed loads around 28%, 63-64%,
and 72-74%. The 72-74% range correctly produced `warning`; sequence 83 was
accepted by IoT Hub and received a Foundry explanation. A physical
`critical >= 85%` transition remains an optional final exercise.

## Step 7: Test the API without hardware

Use PowerShell:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://localhost:8080/api/telemetry `
  -ContentType application/json `
  -Body '{"deviceId":"test","loadPercent":72,"state":"warning","sequence":1}'
```

The gateway replaces the submitted device identity with the configured
`DEVICE_ID`, validates the percentage, state, and sequence, adds a timestamp, and
returns:

```json
{"accepted":true}
```

Invalid data returns HTTP 400:

```json
{"accepted":false,"error":"Invalid telemetry"}
```

## Azure delivery behavior

The local dashboard is intentionally more responsive than the cloud path:

- Every valid board sample updates the local dashboard.
- IoT Hub receives a heartbeat once every `CLOUD_INTERVAL_MS`, default 30
  seconds.
- A state change is sent immediately.
- Simulator messages remain local while
  `ENABLE_SIMULATOR_CLOUD=false`.
- Foundry is called only when a new incident enters `warning` or `critical`.

This rate limiting protects the daily message budget. At a 30-second heartbeat,
one continuously running device sends about 2,880 heartbeat messages per day,
plus state changes, below a 6,400-message daily planning threshold.

## How the LLM explanation is bounded

Foundry receives only the reported device identity, current load, deterministic
state, and the two thresholds. The system prompt requires valid JSON:

```json
{
  "verifiedFacts": "Facts supplied by telemetry",
  "possibleCause": "A clearly labelled hypothesis",
  "suggestedCheck": "A safe human inspection step",
  "limitation": "What cannot be concluded from this data"
}
```

This format demonstrates useful AI reasoning without exposing hidden
chain-of-thought, inventing measurements, or proposing device control.

A future `p19`-only enhancement could provide derived evidence such as previous
value, rolling average, recent minimum/maximum, trend, time above threshold, and
threshold margin. That would make explanations richer without adding another
physical input. It is not implemented in this MVP.

## Disconnect and shutdown behavior

To validate loss of the physical source:

1. Unplug or power off the LPC1768.
2. Wait eight seconds.
3. Confirm **BOARD** changes to offline.
4. Confirm the simulator banner appears.
5. Confirm cloud counts do not increase from simulator traffic under the default
   configuration.

To stop the dashboard and gateway, press `Ctrl+C` in the terminal running
`npm start`. Stopping the board alone cannot stop software hosted by the PC.

## Troubleshooting guide

| Symptom | Resolution |
|---|---|
| Board does not appear on the network | Check USB power, RJ45 cable, extender/router client list, and Ethernet link/activity LEDs. |
| Board responds to ping but no dashboard data arrives | Confirm the PC address matches `gatewayIp`, TCP 8080 is allowed for Node, rebuild, reflash, and press reset. |
| Physical values alternate with simulator values | The stale timeout must exceed the physical send cadence. The gateway uses eight seconds. |
| Physical updates arrive around every five seconds | The firmware creates a new TCP connection per request; the legacy stack makes this slower than the nominal 500 ms loop. |
| Dashboard remains available after unplugging the board | Expected. It is a PC-hosted application and switches to the simulator. |
| CLOUD TX does not increase for every turn | Expected. IoT Hub sends are rate-limited to 30 seconds except for state changes. |
| Foundry does not run for normal samples | Expected. It runs only for new warning or critical incidents. |
| A second gateway will not start | Port 8080 is already owned by the first gateway; stop the first process. |
| USB CDC produces only one JSON record | Use the Ethernet HTTP transport. |
| UDP test works but physical UDP does not | Use the validated HTTP endpoint; UDP is not required by this tutorial. |

## Security and reliability boundaries

- Secrets remain only in ignored `.env`.
- The gateway enforces the configured device identity.
- Incoming JSON is limited to 1 KB and validated.
- Errors are surfaced in gateway logs and dashboard link state.
- The microcontroller makes the alarm decision even if Azure is unavailable.
- Azure and the browser have no device-control path.
- No telemetry persistence is provided.
- Static IPs must be maintained or replaced with a deployment-appropriate
  discovery/configuration mechanism.

## Acceptance status

- [x] Firmware builds and fits LPC1768 flash/RAM.
- [x] Drag-and-drop flashing works.
- [x] Board is reachable at its static Ethernet address.
- [x] Physical HTTP telemetry reaches the Windows gateway.
- [x] Turning `p19` changes the dashboard.
- [x] Physical NORMAL and WARNING states are observed.
- [x] Physical WARNING reaches IoT Hub.
- [x] Physical WARNING receives a Foundry explanation.
- [x] Gateway and React dashboard build.
- [x] Invalid telemetry is rejected.
- [x] Stale physical telemetry falls back to a labelled simulator.
- [x] Simulator cloud traffic is disabled by default.
- [ ] Physical CRITICAL is explicitly exercised.
