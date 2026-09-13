# EdgeOps-86: LPC1768 `p19` to Azure AI Tutorial

This project turns the left-hand Application Board potentiometer, `p19`, into a
complete edge-to-cloud demonstration:

```text
p19 -> LPC1768 state decision -> Ethernet HTTP -> Windows gateway
    -> React dashboard -> Azure IoT Hub -> Azure AI Foundry
```

The LPC1768 calculates the state locally. Azure AI explains an incident but
never determines the state or controls the board.

## MVP boundary

- The only physical input is potentiometer `p19`.
- `p19` represents simulated equipment load from 0 to 100 percent.
- The deterministic thresholds are `normal < 70`, `warning 70-84`, and
  `critical >= 85`.
- The USB cable programs and powers the board; Ethernet carries telemetry.
- No database, cloud-to-device command, acknowledgement, or automated control is
  included.
- Simulator telemetry stays local unless explicitly enabled for cloud delivery.

## 1. Configure the network

The validated setup uses:

```text
Windows gateway: 192.168.29.226
LPC1768 board:    192.168.29.240
Netmask:          255.255.255.0
Router:           192.168.29.1
HTTP port:        8080
```

Change `gatewayIp`, `boardIp`, `netmask`, and `routerIp` in `src/main.cpp` when
using another network. The board and PC must be reachable through the same LAN;
the PC can use Wi-Fi while the board uses the Application Board RJ45 connector.

Native USB CDC is not the telemetry transport. On this LPC1768/Mbed OS
combination it can enumerate correctly but stall after the first message.
Ethernet HTTP is the reliable MVP path and keeps Azure credentials off the
microcontroller.

## 2. Build and flash the LPC1768

PlatformIO must run with Python 3.11 for this legacy Mbed platform:

```powershell
C:\Users\vineetkaul\.platformio-py311\Scripts\platformio.exe run
```

Copy `.pio\build\lpc1768\firmware.bin` to the mounted `MBED` drive, wait for the
copy to finish, and press the LPC1768 reset button. Leave the narrow LPC1768 USB
connector attached for power.

Connect the Application Board RJ45 socket to the router or Ethernet extender.
The firmware reads only `p19`, classifies the value, and posts this shape to the
PC:

```json
{
  "deviceId": "lpc1768-01",
  "loadPercent": 72,
  "state": "warning",
  "sequence": 83
}
```

The destination is `POST http://192.168.29.226:8080/api/telemetry`. LED1 toggles
after a request is sent successfully.

## 3. Configure the Windows gateway

Copy `.env.example` to `.env` and set the two secrets:

```text
IOT_HUB_DEVICE_CONNECTION_STRING=
FOUNDRY_API_KEY=
```

The non-secret defaults select Ethernet, device identity `lpc1768-01`, dashboard
port `8080`, a 30-second cloud heartbeat, and a local-only simulator. Never
commit `.env`.

Install, build, and start:

```powershell
npm install
npm run build
npm start
```

Open `http://localhost:8080`. The gateway validates incoming JSON, applies the
configured device identity, timestamps it, updates the browser over
server-sent events, and rate-limits cloud traffic.

## 4. Read the dashboard

- **BOARD** becomes ready after valid physical telemetry arrives.
- **SIMULATOR INPUT ACTIVE** means no board message has arrived for eight
  seconds. The dashboard remains available because it runs on the PC.
- **SIMULATED LOAD / CONTROL P19** tracks the physical knob when the source is
  the board.
- **WARN 070** and **CRIT 085** show the firmware thresholds.
- **CLOUD TX** counts accepted IoT Hub messages, not every local dashboard
  update.
- **INCIDENT TIMELINE** records deterministic state transitions.
- **FOUNDRY** presents verified facts, a possible cause, a suggested check, and
  a limitation. This is bounded diagnostic advice, not hidden chain-of-thought.

IoT Hub receives a heartbeat approximately every 30 seconds and receives state
changes immediately. Foundry is called only for a new warning or critical
incident.

## 5. Verify the complete path

1. Start the gateway before resetting the board.
2. Check `http://localhost:8080/api/health`.
3. Reset the board and wait for **BOARD** to become ready.
4. Turn `p19` below 70 and confirm **NORMAL**.
5. Turn `p19` from 70 through 84 and confirm **WARNING**, an IoT Hub state-change
   message, and a Foundry explanation.
6. Optionally turn `p19` to 85 or above and confirm **CRITICAL**.
7. Unplug the board. After eight seconds, **BOARD** becomes offline and the
   clearly labelled simulator resumes. With the default configuration, this
   simulator does not send Azure traffic.

To test the HTTP contract without the board:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://localhost:8080/api/telemetry `
  -ContentType application/json `
  -Body '{"deviceId":"test","loadPercent":72,"state":"warning","sequence":1}'
```

The gateway returns HTTP `202` for valid telemetry and HTTP `400` for invalid
telemetry.

## Troubleshooting

| Symptom | Check |
|---|---|
| Dashboard still runs after unplugging the board | Expected: Node/React runs on the PC and the simulator resumes after eight seconds. |
| Dashboard shows simulator while the board is connected | Confirm board power, RJ45 link lights, board IP, PC IP, and that TCP port 8080 is allowed for Node. |
| Board is visible on the router but data does not arrive | Confirm `gatewayIp` in `src/main.cpp`, rebuild, reflash, and press reset. |
| Dashboard changes only every few seconds | Opening a new TCP connection for every request is expensive on this legacy stack; the observed physical cadence is about five seconds. |
| IoT count does not change with every knob movement | Expected: cloud heartbeat is rate-limited to 30 seconds, with immediate sends only on state changes. |
| Foundry does not run in NORMAL | Expected: explanations are requested only for new warning or critical incidents. |
| Port 8080 is already in use | Stop the earlier Node gateway before starting another instance. |
| USB serial sends one record and stops | Use Ethernet HTTP; native USB CDC is not the supported MVP transport. |

Stop the gateway with `Ctrl+C`. Stopping or unplugging the board alone does not
stop the PC-hosted dashboard.

## Verified result and limitations

The physical board has delivered changing `p19` values to the dashboard. NORMAL
and WARNING were observed; a physical warning reached IoT Hub and received a
Foundry explanation. A physical CRITICAL transition remains an optional final
exercise.

The current firmware uses static IP addresses and opens a new TCP connection for
each request. That is adequate for this concept demonstration, but persistent
HTTP/MQTT or a lighter transport would be preferable for a production device.

See `documentation/EDGEOPS-86-MVP.md` in the parent repository for the expanded
architecture, behavior, and demonstration guide.
