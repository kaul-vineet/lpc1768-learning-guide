# EdgeOps-86 Multi-Control MVP Tutorial

## Goal

Build a repeatable two-minute hackathon demonstration using only the peripherals
already present on the mbed LPC1768 Application Board:

```text
physical controls -> deterministic edge decision -> Azure delivery
                  -> evidence-grounded LLM interpretation
```

The demonstration is intentionally not a production monitoring product. It has
no database, authentication, prediction, arbitrary chat, or device-control path.

## Hardware roles

| Board input | Pin or bus | Demonstration role |
|---|---|---|
| Potentiometer 1 | `p19` | Simulated equipment demand/load |
| Potentiometer 2 | `p20` | Simulated cooling capacity |
| Joystick centre | `p14` | NORMAL operating mode |
| Joystick up | `p15` | BOOST operating mode |
| Joystick down | `p12` | MAINTENANCE operating mode |
| LM75B | SDA `p28`, SCL `p27`, address `0x48` | Actual ambient temperature supporting evidence |
| C12832 LCD | SPI `p5/p7`, reset `p6`, A0 `p8`, CS `p11` | Local edge dashboard output |

Joystick left `p13` and right `p16` are deliberately unused.

The potentiometers are continuous inputs. Joystick selections are latched by
firmware, so the selected mode remains after the joystick is released.

Physical testing established that the joystick switches are active-high on this
board. The firmware uses `PullDown`, treats `1` as pressed, and polls every 20
ms in a dedicated thread so momentary presses are not hidden by slow network
operations.

Each analog channel discards one settling read, waits 100 microseconds, averages
16 samples, and applies a one-percentage-point deadband. This prevents
cross-channel movement and visible noise.

## Architecture and responsibility

```text
p19 load --------\
p20 cooling ------+--> LPC1768 deterministic risk
joystick mode ----+             |
LM75B temperature-/             | Ethernet HTTP JSON
          |                     v
          v              Windows Node gateway
    C12832 LCD            /        |        \
                        /         |         \
               React dashboard  IoT Hub   AI Foundry
                    SSE         telemetry  interpretation
```

The responsibility boundary is strict:

- **LPC1768:** reads hardware and assigns deterministic risk.
- **C12832 LCD:** shows local edge facts even when Azure is unavailable.
- **Gateway:** validates telemetry and calculates mathematical evidence.
- **IoT Hub:** receives rate-limited device telemetry.
- **Foundry:** explains supplied evidence in operational language.
- **Dashboard:** displays the physical signal, evidence, delivery, and
  explanation.

Foundry cannot override the deterministic risk and there is no
cloud-to-device control.

## Deterministic risk model

The firmware and gateway use the same rules:

```text
headroom = coolingPercent - loadPercent

CRITICAL when loadPercent >= 85 and headroom < 0
WARNING  when loadPercent >= 70 or headroom < 0
NORMAL   otherwise
```

Examples:

| Load | Cooling | Headroom | Result |
|---:|---:|---:|---|
| 40% | 70% | +30 | NORMAL |
| 76% | 85% | +9 | WARNING because load is high |
| 65% | 40% | -25 | WARNING because demand exceeds capacity |
| 88% | 35% | -53 | CRITICAL |

Mode and temperature add context but do not change these rules. This keeps the
safety story explainable and testable.

## Gateway evidence model

The gateway keeps the latest 120 samples in memory and derives:

- Capacity headroom
- Load trend
- Cooling trend
- Temperature trend
- Capacity-deficit duration
- Balanced, transient-deficit, or sustained-deficit pattern
- Authoritative deterministic risk

Trend is intentionally simple: changes above a small deadband are rising or
falling; smaller changes are stable. A deficit becomes sustained after ten
seconds. These values disappear when the gateway stops.

## Network setup

The validated LAN addresses are:

```text
Windows gateway: 192.168.29.226
LPC1768 board:    192.168.29.240
Netmask:          255.255.255.0
Router:           192.168.29.1
HTTP port:        8080
Optional UDP:     41234
```

The PC can use Wi-Fi while the Application Board connects by Ethernet to the
same router or range extender. If the network changes, edit `gatewayIp`,
`boardIp`, `netmask`, and `routerIp` in
`projects/lxp-iot-llm/src/main.cpp`.

USB is retained for drag-and-drop programming and power. Ethernet HTTP is used
for telemetry because the tested LPC1768/Mbed native USB CDC path stalled after
its first message.

## Build and flash firmware

From `projects/lxp-iot-llm`, build with the Python 3.11 PlatformIO environment:

```powershell
C:\Users\vineetkaul\.platformio-py311\Scripts\platformio.exe run
```

The binary is:

```text
.pio\build\lpc1768\firmware.bin
```

1. Connect USB to the narrow LPC1768 module.
2. Copy `firmware.bin` to the mounted `MBED` drive.
3. Keep USB connected for power.
4. Connect the Application Board RJ45 port.
5. Press reset.

The firmware reads all inputs, assigns state, and posts:

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

LM75B failure is explicit:

```json
{
  "temperatureC": null,
  "temperatureValid": false
}
```

The firmware never substitutes a fabricated temperature.

## Local C12832 screen

The LCD driver uses a buffered Mbed 6 implementation and a dedicated display
thread. This keeps page switching and critical blinking responsive while the
legacy Ethernet stack opens and closes TCP connections.

During NORMAL operation, the screen alternates every two seconds:

```text
L40 C70 H+30 TX:OK
[load bar]
[cooling bar]
```

```text
MODE normal
TEMP 27.4 C
STATE NORMAL H+30
```

WARNING and CRITICAL override both pages:

```text
! WARNING ! TX:OK
LOAD 82 COOL 35
DEF -47 14s boost
```

The CRITICAL page blinks by alternating normal and inverted display modes.
`TX:OK` means only that the board sent the HTTP request to the gateway. The
screen does not claim IoT Hub acceptance or Foundry completion.

The board does not display LLM prose. Keeping the full explanation in the
browser avoids a cloud-to-device return path and preserves the clean
edge-versus-cloud responsibility boundary.

## Configure Azure and start the gateway

Copy `.env.example` to `.env` and set:

```text
IOT_HUB_DEVICE_CONNECTION_STRING=
FOUNDRY_API_KEY=
```

The non-secret defaults select Ethernet, port 8080, device
`lpc1768-01`, a 30-second IoT heartbeat, and a local-only simulator.
Never commit `.env`.

```powershell
npm install
npm run build
npm start
```

Open:

```text
http://localhost:8080
```

Endpoints:

```text
GET  /api/health
GET  /api/status
POST /api/telemetry
GET  /events
```

## Dashboard design

The dashboard presents one simple causal story:

```text
observe physical inputs -> detect at the edge -> deliver through IoT
                        -> explain with Foundry -> human action
```

| Area | Display |
|---|---|
| Risk | Deterministic NORMAL, WARNING, or CRITICAL |
| Load | Large equipment-load percentage gauge |
| Cooling | Large cooling-capacity percentage gauge |
| Context | Joystick mode, temperature, and temperature trend |
| Balance | Positive headroom, balanced, or negative deficit |
| Evidence | Load trend, cooling trend, deficit duration, pattern |
| AI assessment | Assessment, factors, action, recovery, limitation |
| Delivery | Separate board, IoT Hub, and Foundry readiness |

The browser contains no duplicate software controls. The physical board drives
the demonstration.

If no board message arrives for eight seconds, the board indicator changes to
offline and a clearly labelled simulator resumes. The dashboard remains running
because it is hosted by the PC.

## Controlled Foundry prompt

The prompt is versioned as `edgeops-multicontrol-v1`. It defines:

- Load as simulated demand
- Cooling as simulated available capacity
- Headroom as cooling minus load
- Negative headroom as a capacity deficit
- NORMAL, BOOST, and MAINTENANCE mode meanings
- Temperature as supporting evidence only
- Deterministic risk as authoritative

It prohibits invented measurements, unsupported fault claims, risk
reclassification, and device commands. Foundry must return:

```json
{
  "assessment": "Concise interpretation of the supplied condition",
  "contributingFactors": [
    "One to five evidence-grounded factors"
  ],
  "recommendedAction": "One safe human check or simulated adjustment",
  "expectedRecovery": "Observable evidence that conditions are improving",
  "limitation": "What cannot be concluded from these inputs"
}
```

The gateway rejects a response that does not match this structure.

Foundry is requested on:

- A transition to WARNING or CRITICAL
- A recovery transition
- A joystick mode change while risk is active

It is not requested for every knob movement.

## Test without the board

The built-in simulator cycles through balanced operation, increasing demand,
critical deficit, BOOST recovery, and MAINTENANCE. Simulator traffic remains
local unless `ENABLE_SIMULATOR_CLOUD=true`.

Post a physical-style message with PowerShell:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://localhost:8080/api/telemetry `
  -ContentType application/json `
  -Body '{"deviceId":"test","loadPercent":82,"coolingPercent":35,"mode":"normal","temperatureC":27.4,"temperatureValid":true,"state":"warning","sequence":1}'
```

Expected result:

```json
{"accepted":true}
```

Invalid input returns HTTP 400. This includes an invalid mode, percentage,
temperature range, inconsistent temperature validity, or state that disagrees
with the deterministic rules.

## Physical acceptance test

The following acceptance sequence has been completed on the physical board:

1. Start the gateway.
2. Flash the multi-control firmware.
3. Reset the board and confirm BOARD becomes ready.
4. Turn `p19`; confirm only the load gauge follows it.
5. Turn `p20`; confirm only the cooling gauge follows it.
6. Press joystick up; confirm BOOST remains selected after release.
7. Press joystick down; confirm MAINTENANCE remains selected.
8. Press joystick centre; confirm NORMAL returns.
9. Confirm LM75B reports a plausible room temperature.
10. Confirm the LCD alternates between its balance and context pages.
11. Hold load below cooling and confirm positive headroom on LCD and browser.
12. Raise load above cooling and confirm the LCD WARNING override.
13. Raise load to at least 85 while cooling remains lower and confirm the
    blinking CRITICAL override.
14. Select BOOST and raise cooling; confirm the deficit shrinks.
15. Lower load below 70 with non-negative headroom; confirm recovery to NORMAL.
16. Confirm IoT Hub accepts the transition and Foundry returns the five required
    fields.
17. Unplug the board and confirm simulator fallback after eight seconds.

Observed incident and recovery values:

| Phase | Load | Cooling | Headroom | Result |
|---|---:|---:|---:|---|
| Baseline | 64% | 77% | +13 | NORMAL |
| Threshold | 71% | 73% | +2 | WARNING |
| Deficit | 84% | 73% | -11 | WARNING |
| Incident | 90% | 73% | -17 | CRITICAL |
| Partial recovery | 90% | 92% | +2 | WARNING |
| Full recovery | 62% | 92% | +30 | NORMAL |

Partial recovery remains WARNING because load is still above 70%, even though
cooling has restored positive headroom.

## Two-minute hackathon script

1. **Balanced:** Set load near 40% and cooling near 70%. Point to positive
   headroom and NORMAL.
2. **Deficit:** Raise load above cooling. Point to negative headroom, rising
   duration, and WARNING.
3. **Critical:** Move load above 85% while cooling remains lower. Point to the
   deterministic CRITICAL decision.
4. **Response:** Push joystick up for BOOST and raise cooling.
5. **Recovery:** Lower load or raise cooling until headroom is non-negative and
   load is below 70%.
6. **AI value:** Show the Foundry assessment, ranked factors, safe action,
   recovery evidence, and limitation.

Temperature can be warmed gently by hand as optional supporting evidence. Do not
make the core demonstration depend on a rapid temperature change.

## Cloud behavior

- Every valid sample updates the local dashboard.
- IoT Hub receives a heartbeat approximately every 30 seconds.
- State transitions and relevant mode events send immediately.
- Simulator cloud delivery is disabled by default.
- Foundry runs only for meaningful transitions.

At a 30-second heartbeat, one continuously running device produces about 2,880
heartbeat messages per day, plus transitions.

## Troubleshooting

| Symptom | Check |
|---|---|
| Dashboard remains running after the board is unplugged | Expected; the PC hosts it and the simulator resumes after eight seconds. |
| Board does not become ready | Check USB power, Ethernet cable/link lights, board IP, gateway IP, and TCP port 8080. |
| One potentiometer changes the wrong gauge | Verify `p19` is load and `p20` is cooling. |
| Potentiometer direction feels reversed | Invert the corresponding ADC percentage in firmware. |
| Joystick mode does not change | Verify active-high wiring, `PullDown`, pressed state `1`, the 20 ms polling thread, and pins `p12/p14/p15`. |
| Both analog values move while touching one control | Verify the discarded settling read, 100 microsecond settling delay, 16-sample average, and one-point deadband. |
| Temperature shows SENSOR ERROR | Reseat the LPC1768 module and verify I2C `p28/p27`; the gateway will not invent a reading. |
| LCD is blank or reversed | Press reset, verify the module is fully seated, then check orientation and contrast on the physical board. |
| LCD shows `TX:--` | The last gateway socket send failed; verify Ethernet and the configured gateway address. |
| Physical updates arrive every few seconds | The legacy stack opens a new TCP connection for every request; this is acceptable for the demo. |
| IoT count does not change for every movement | Expected because the cloud heartbeat is rate-limited. |
| Foundry does not run continuously | Expected; it is transition-driven. |
| A second gateway cannot start | Stop the first process because port 8080 is already occupied. |

Stop the gateway with `Ctrl+C`.

## Validation status

- [x] Multi-control firmware compiles and fits LPC1768 memory.
- [x] C12832 driver and local display thread compile.
- [x] Dashboard and gateway compile.
- [x] Simulator provides all demonstration phases.
- [x] Valid multi-control HTTP telemetry returns 202.
- [x] Invalid temperature validity returns 400.
- [x] Physical `p19` and `p20` are validated with stable independent readings.
- [x] Active-high joystick mode latching is validated.
- [x] Physical LM75B temperature is validated.
- [x] Physical LCD orientation, contrast, refresh, alert override, blink, and
  TX status are validated.
- [x] Physical NORMAL, WARNING, CRITICAL, BOOST, and recovery are validated.
- [x] IoT Hub delivery is validated.
- [x] Strict Foundry WARNING, CRITICAL, BOOST, and recovery responses are
  validated.

The root learning website's final capstone contains the consolidated physical
findings and reusable design conclusions.
