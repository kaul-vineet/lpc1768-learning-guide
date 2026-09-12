# EdgeOps-86 MVP

EdgeOps-86 is a device-to-cloud hackathon demonstrator for the original mbed
LPC1768 module and MSI-0315B / mbed-014.1 Revision B Application Board.

The MVP reads potentiometer `p19` as simulated equipment load, assigns
deterministic local alarm states, sends JSON through native USB CDC, forwards
rate-limited telemetry to Azure IoT Hub, requests bounded incident explanations
from Azure AI Foundry, and displays everything in a local React control panel.

## Safety and scope

- The potentiometer represents simulated load; it is not a machine measurement.
- The LPC1768 owns alarm classification.
- Azure and the dashboard cannot control or acknowledge the board.
- No telemetry database is used.
- Simulator-to-cloud traffic is disabled by default.
- Never commit `.env`; it contains Azure credentials.

## Architecture

```text
Application Board p19
        |
        v
LPC1768 deterministic state
        |
        | Native USB CDC JSON
        v
Windows Node.js gateway
        |----------------------|
        v                      v
Azure IoT Hub          Azure AI Foundry
        |----------------------|
                   |
                   v
        React EdgeOps-86 dashboard
```

## Confirmed Azure resources

```text
IoT Hub:          stell-iot-hub.azure-devices.net
Device identity:  lpc1768-01
Foundry account:  stell-foundry
Foundry project:  proj-default
Deployment:       gpt-5
```

## Build the firmware

1. Open the project in Visual Studio Code.
2. Select **Terminal > New Terminal**.
3. Run:

   ```powershell
   C:\Users\vineetkaul\.platformio-py311\Scripts\platformio.exe run
   ```

4. Confirm the final line contains `SUCCESS`.
5. The firmware is created at:

   ```text
   .pio\build\lpc1768\firmware.bin
   ```

PlatformIO must use Python 3.11 because the legacy Mbed integration imports
Python modules removed in Python 3.12.

## Flash the firmware

1. Connect the PC cable to the USB connector on the narrow LPC1768 module.
2. Confirm the `MBED` drive appears.
3. Copy `.pio\build\lpc1768\firmware.bin` to the `MBED` drive.
4. Wait until copying finishes.
5. Disconnect the cable from the LPC1768 module.

## Connect native USB telemetry

The programming interface does not provide a COM port on this ARM64 Windows PC.
The firmware therefore uses the LPC1768 native USB device interface.

1. Ensure the board is unplugged.
2. Locate `SW2` beside the Application Board USB connectors.
3. Move both `SW2` switches away from the side marked `ON`.
4. Do not use the large rectangular USB-A host socket.
5. Connect the PC cable to the small USB-B/mini-USB connector on the Application
   Board.
6. Leave the narrow LPC1768 module USB connector empty.
7. Open **Device Manager > Ports (COM & LPT)**.
8. Confirm a new **USB Serial Device (COMx)** appears.

The verified Revision B schematic confirms that Application Board USB-B supplies
power through a protection diode and connects to the LPC1768 native `D+` and
`D-` signals.

## Configure the gateway

Copy `.env.example` to `.env` and populate:

```text
IOT_HUB_DEVICE_CONNECTION_STRING
FOUNDRY_API_KEY
```

The current workstation already has a local `.env`. It is ignored by Git.

## Build and start

```powershell
npm install
npm run build
npm start
```

Open:

```text
http://localhost:8080
```

If no COM port is detected, the dashboard clearly displays
`SIMULATOR INPUT ACTIVE`. Simulator data remains local unless
`ENABLE_SIMULATOR_CLOUD=true` is deliberately set.

## MVP acceptance checklist

- [x] LPC1768 firmware builds.
- [x] Drag-and-drop flashing works.
- [x] Native USB telemetry firmware fits in flash and RAM.
- [x] Gateway and React dashboard build.
- [x] Dashboard serves successfully on port 8080.
- [x] Simulator updates the dashboard.
- [x] Simulator cloud traffic is disabled by default.
- [x] IoT Hub device identity exists and accepts telemetry.
- [x] Foundry returns facts, a hypothesis, a suggested check, and a limitation.
- [x] Invalid telemetry fails the gateway self-check.
- [ ] Native USB CDC appears as a Windows COM port.
- [ ] Turning `p19` changes live load on the dashboard.
- [ ] Physical warning and critical transitions reach IoT Hub.
- [ ] Physical warning and critical transitions receive Foundry explanations.

## Cloud message budget

- Local dashboard: up to 2-4 updates per second.
- IoT Hub heartbeat: once every 30 seconds.
- State changes: transmitted immediately.
- Foundry: called only for new warning or critical incidents.
- Escalate the IoT tier only if projected usage exceeds 6,400 messages per day.
