#include "mbed.h"
#include "EthernetInterface.h"
#include "TCPSocket.h"
#include "C12832A1Z.h"
#include <atomic>

using namespace std::chrono_literals;

namespace {
// VK: These addresses describe the validated demo LAN. Change them together when moving the setup.
constexpr char gatewayIp[] = "192.168.29.226";
constexpr uint16_t gatewayPort = 8080;
constexpr char boardIp[] = "192.168.29.240";
constexpr char netmask[] = "255.255.255.0";
constexpr char routerIp[] = "192.168.29.1";
constexpr int lm75bAddress = 0x90;

enum class OperatingMode {
    Normal,
    Boost,
    Maintenance
};

// VK: Risk is deliberately small and deterministic so the board remains the final authority.
enum class RiskState {
    Normal,
    Warning,
    Critical
};

// VK: The display thread receives one complete snapshot so it never mixes values from different samples.
struct DisplaySnapshot {
    unsigned loadPercent;
    unsigned coolingPercent;
    OperatingMode mode;
    float temperatureC;
    bool temperatureValid;
    RiskState state;
    unsigned deficitDurationSeconds;
    bool gatewayDelivered;
};

// VK: p19 and p20 are treated as demand and available cooling, not as generic unnamed knobs.
DigitalOut statusLed(LED1);
AnalogIn simulatedLoad(p19);
AnalogIn simulatedCooling(p20);
DigitalIn joystickDown(p12, PullDown);
DigitalIn joystickCenter(p14, PullDown);
DigitalIn joystickUp(p15, PullDown);
I2C temperatureBus(p28, p27);
C12832A1Z lcd(p5, p7, p6, p8, p11);
Mutex displayMutex;
Thread displayThread(osPriorityNormal, 4096);
Thread joystickThread(osPriorityNormal, 2048);
// VK: The joystick thread writes the selected mode while the telemetry loop reads it without blocking.
std::atomic<OperatingMode> selectedMode{OperatingMode::Normal};
DisplaySnapshot displaySnapshot{
    0,
    0,
    OperatingMode::Normal,
    0.0f,
    false,
    RiskState::Normal,
    0,
    false
};

const char *modeName(OperatingMode mode)
{
    // VK: Lower-case names are part of the JSON contract consumed by the gateway.
    switch (mode) {
        case OperatingMode::Boost:
            return "boost";
        case OperatingMode::Maintenance:
            return "maintenance";
        default:
            return "normal";
    }
}

void selectNormalMode()
{
    // VK: Mode selection is latched; releasing the joystick does not cancel the operator's choice.
    selectedMode.store(OperatingMode::Normal, std::memory_order_relaxed);
}

void selectBoostMode()
{
    selectedMode.store(OperatingMode::Boost, std::memory_order_relaxed);
}

void selectMaintenanceMode()
{
    selectedMode.store(OperatingMode::Maintenance, std::memory_order_relaxed);
}

void joystickTask()
{
    // VK: The network call can take seconds, so joystick presses are captured in a small independent loop.
    bool previousDownPressed = false;
    bool previousCenterPressed = false;
    bool previousUpPressed = false;

    while (true) {
        const bool downPressed = joystickDown.read() != 0;
        const bool centerPressed = joystickCenter.read() != 0;
        const bool upPressed = joystickUp.read() != 0;

        if (centerPressed && !previousCenterPressed) {
            selectNormalMode();
        } else if (upPressed && !previousUpPressed) {
            selectBoostMode();
        } else if (downPressed && !previousDownPressed) {
            selectMaintenanceMode();
        }

        previousDownPressed = downPressed;
        previousCenterPressed = centerPressed;
        previousUpPressed = upPressed;
        ThisThread::sleep_for(20ms);
    }
}

const char *modeShortName(OperatingMode mode)
{
    // VK: The 128x32 display needs compact labels, while telemetry keeps the full names.
    switch (mode) {
        case OperatingMode::Boost:
            return "BST";
        case OperatingMode::Maintenance:
            return "MNT";
        default:
            return "NRM";
    }
}

const char *stateName(RiskState state)
{
    // VK: These values must stay aligned with the gateway's MachineState type.
    switch (state) {
        case RiskState::Critical:
            return "critical";
        case RiskState::Warning:
            return "warning";
        default:
            return "normal";
    }
}

uint64_t millisecondsSinceBoot()
{
    // VK: A monotonic clock is used for blink timing and deficit duration; wall-clock time is unnecessary here.
    return static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            Kernel::Clock::now().time_since_epoch())
            .count());
}

void formatTemperature(
    char *output,
    size_t outputSize,
    float temperatureC)
{
    // VK: This toolchain did not print floats reliably, so temperature is formatted as integer tenths.
    const int tenths = static_cast<int>(
        temperatureC * 10.0f + (temperatureC >= 0.0f ? 0.5f : -0.5f));
    const unsigned magnitude =
        static_cast<unsigned>(tenths < 0 ? -tenths : tenths);
    snprintf(
        output,
        outputSize,
        "%s%u.%u",
        tenths < 0 ? "-" : "",
        magnitude / 10U,
        magnitude % 10U);
}

unsigned readStablePercent(
    AnalogIn &input,
    unsigned previousPercent,
    bool initialized)
{
    // VK: Discard the first conversion after changing ADC channels, then average out the remaining noise.
    input.read_u16();
    wait_us(100);

    uint32_t total = 0;
    constexpr unsigned sampleCount = 16;
    for (unsigned sample = 0; sample < sampleCount; ++sample) {
        total += input.read_u16();
        wait_us(50);
    }

    const unsigned percent = static_cast<unsigned>(
        ((total / sampleCount) * 100U + 32767U) / 65535U);
    if (initialized) {
        const unsigned difference =
            percent > previousPercent
                ? percent - previousPercent
                : previousPercent - percent;
        if (difference <= 1U) {
            // VK: A one-point deadband stops harmless ADC jitter from looking like operator movement.
            return previousPercent;
        }
    }
    return percent > 100U ? 100U : percent;
}

void drawBar(int y, unsigned value)
{
    // VK: Bars provide a quick physical comparison when the small screen cannot show a full chart.
    lcd.rectangle(0, y, 127, y + 6);
    if (value > 0) {
        const int width = static_cast<int>((124U * value) / 100U);
        lcd.fillrect(2, y + 2, 2 + width, y + 4);
    }
}

void drawDisplay(const DisplaySnapshot &snapshot)
{
    const int headroom =
        static_cast<int>(snapshot.coolingPercent) -
        static_cast<int>(snapshot.loadPercent);
    const bool criticalBlink =
        snapshot.state == RiskState::Critical &&
        ((millisecondsSinceBoot() / 500U) % 2U) == 0U;

    // VK: Only CRITICAL blinks; WARNING stays readable while still replacing the normal pages.
    lcd.display(criticalBlink ? INVERT : DEFAULT);
    lcd.fillrect(0, 0, 127, 31, WHITE);

    // VK: Local alarms take over the screen; cloud explanations intentionally stay on the browser.
    if (snapshot.state != RiskState::Normal) {
        lcd.locate(0, 0);
        lcd.printf(
            snapshot.state == RiskState::Critical
                ? "!! CRITICAL !! TX:%s"
                : "! WARNING ! TX:%s",
            snapshot.gatewayDelivered ? "OK" : "--");
        lcd.locate(0, 10);
        lcd.printf(
            "LOAD %u COOL %u",
            snapshot.loadPercent,
            snapshot.coolingPercent);
        lcd.locate(0, 20);
        lcd.printf(
            "D%d %us MODE:%s",
            headroom,
            snapshot.deficitDurationSeconds,
            modeShortName(snapshot.mode));
        lcd.update();
        return;
    }

    const bool balancePage =
        ((millisecondsSinceBoot() / 2000U) % 2U) == 0U;
    if (balancePage) {
        lcd.locate(0, 0);
        lcd.printf(
            "L%u C%u H%+d TX:%s",
            snapshot.loadPercent,
            snapshot.coolingPercent,
            headroom,
            snapshot.gatewayDelivered ? "OK" : "--");
        drawBar(10, snapshot.loadPercent);
        drawBar(22, snapshot.coolingPercent);
    } else {
        lcd.locate(0, 0);
        lcd.printf("MODE %s", modeName(snapshot.mode));
        lcd.locate(0, 10);
        if (snapshot.temperatureValid) {
            char temperatureText[16];
            formatTemperature(
                temperatureText,
                sizeof(temperatureText),
                snapshot.temperatureC);
            lcd.printf("TEMP %s C", temperatureText);
        } else {
            lcd.printf("TEMP SENSOR ERROR");
        }
        lcd.locate(0, 20);
        lcd.printf("STATE NORMAL H%+d", headroom);
    }
    lcd.update();
}

void displayTask()
{
    // VK: Rendering runs separately so a slow TCP connection cannot freeze local safety feedback.
    lcd.update(MANUAL);
    while (true) {
        // VK: Copy under the mutex, then draw without holding it to keep the telemetry loop responsive.
        displayMutex.lock();
        const DisplaySnapshot snapshot = displaySnapshot;
        displayMutex.unlock();
        drawDisplay(snapshot);
        ThisThread::sleep_for(250ms);
    }
}

void updateDisplay(
    unsigned loadPercent,
    unsigned coolingPercent,
    OperatingMode mode,
    float temperatureC,
    bool temperatureValid,
    RiskState state,
    unsigned deficitDurationSeconds,
    bool gatewayDelivered)
{
    // VK: Publish the whole view atomically rather than updating individual fields during a redraw.
    displayMutex.lock();
    displaySnapshot = {
        loadPercent,
        coolingPercent,
        mode,
        temperatureC,
        temperatureValid,
        state,
        deficitDurationSeconds,
        gatewayDelivered
    };
    displayMutex.unlock();
}

bool readTemperature(float &temperatureC)
{
    // VK: LM75B access is explicit; a failed bus transaction becomes invalid telemetry, never a fake zero.
    char temperatureRegister = 0;
    char data[2];
    if (temperatureBus.write(
            lm75bAddress, &temperatureRegister, 1, true) != 0 ||
        temperatureBus.read(lm75bAddress, data, sizeof(data)) != 0) {
        return false;
    }

    const int16_t raw =
        static_cast<int16_t>(
            (static_cast<uint16_t>(static_cast<uint8_t>(data[0])) << 8) |
            static_cast<uint8_t>(data[1]));
    temperatureC = static_cast<float>(raw) / 256.0f;
    // VK: The sensor's documented range is also a useful guard against corrupt I2C bytes.
    return temperatureC >= -55.0f && temperatureC <= 125.0f;
}

bool sendAll(TCPSocket &socket, const char *data, size_t length)
{
    // VK: TCP may accept only part of the request, so keep sending until every byte is written.
    size_t offset = 0;
    while (offset < length) {
        const nsapi_size_or_error_t sent =
            socket.send(data + offset, length - offset);
        if (sent <= 0) {
            return false;
        }
        offset += static_cast<size_t>(sent);
    }
    return true;
}
}

int main()
{
    // VK: Local input and display threads start before networking so the board remains usable during retries.
    temperatureBus.frequency(100000);
    joystickThread.start(joystickTask);
    displayThread.start(displayTask);

    EthernetInterface network;
    // VK: Static addressing made the hackathon setup repeatable on the validated local network.
    network.set_network(
        SocketAddress(boardIp),
        SocketAddress(netmask),
        SocketAddress(routerIp));
    while (network.connect() != NSAPI_ERROR_OK) {
        // VK: A visible heartbeat shows that firmware is alive even while Ethernet is unavailable.
        statusLed = !statusLed;
        ThisThread::sleep_for(2s);
    }

    const SocketAddress gateway(gatewayIp, gatewayPort);
    unsigned long sequence = 0;
    OperatingMode mode = OperatingMode::Normal;
    bool gatewayDelivered = false;
    uint64_t deficitStartedAtMs = 0;
    unsigned loadPercent = 0;
    unsigned coolingPercent = 0;
    bool analogInitialized = false;
    char body[240];
    char request[440];

    while (true) {
        loadPercent =
            readStablePercent(simulatedLoad, loadPercent, analogInitialized);
        coolingPercent =
            readStablePercent(
                simulatedCooling,
                coolingPercent,
                analogInitialized);
        analogInitialized = true;

        mode = selectedMode.load(std::memory_order_relaxed);

        // VK: Risk is decided here on the device. Azure and the LLM can explain it, but cannot change it.
        RiskState state = RiskState::Normal;
        if (loadPercent >= 85 && coolingPercent < loadPercent) {
            state = RiskState::Critical;
        } else if (loadPercent >= 70 || coolingPercent < loadPercent) {
            state = RiskState::Warning;
        }

        float temperatureC = 0.0f;
        const bool temperatureValid = readTemperature(temperatureC);
        const uint64_t nowMs = millisecondsSinceBoot();
        // VK: Deficit duration starts when demand first exceeds cooling and resets only after capacity recovers.
        if (coolingPercent < loadPercent) {
            if (deficitStartedAtMs == 0) {
                deficitStartedAtMs = nowMs;
            }
        } else {
            deficitStartedAtMs = 0;
        }
        const unsigned deficitDurationSeconds =
            deficitStartedAtMs == 0
                ? 0
                : static_cast<unsigned>((nowMs - deficitStartedAtMs) / 1000U);
        updateDisplay(
            loadPercent,
            coolingPercent,
            mode,
            temperatureC,
            temperatureValid,
            state,
            deficitDurationSeconds,
            gatewayDelivered);

        char temperatureValue[16];
        if (temperatureValid) {
            formatTemperature(
                temperatureValue,
                sizeof(temperatureValue),
                temperatureC);
        } else {
            // VK: JSON null clearly distinguishes an unavailable sensor from a genuine 0-degree reading.
            snprintf(temperatureValue, sizeof(temperatureValue), "null");
        }

        // VK: The board sends raw facts plus its decision; trends and explanations belong downstream.
        const int bodyLength = snprintf(
            body,
            sizeof(body),
            "{\"deviceId\":\"lpc1768-01\",\"loadPercent\":%u,"
            "\"coolingPercent\":%u,\"mode\":\"%s\","
            "\"temperatureC\":%s,\"temperatureValid\":%s,"
            "\"state\":\"%s\",\"sequence\":%lu}",
            loadPercent,
            coolingPercent,
            modeName(mode),
            temperatureValue,
            temperatureValid ? "true" : "false",
            stateName(state),
            sequence++);

        // VK: Connection-close HTTP is simple and dependable on this legacy Ethernet stack.
        const int requestLength = snprintf(
            request,
            sizeof(request),
            "POST /api/telemetry HTTP/1.1\r\n"
            "Host: %s\r\n"
            "Content-Type: application/json\r\n"
            "Content-Length: %d\r\n"
            "Connection: close\r\n\r\n%s",
            gatewayIp,
            bodyLength,
            body);

        // VK: Never transmit a truncated payload if either fixed buffer was too small.
        if (bodyLength > 0 &&
            bodyLength < static_cast<int>(sizeof(body)) &&
            requestLength > 0 &&
            requestLength < static_cast<int>(sizeof(request))) {
            TCPSocket socket;
            socket.set_timeout(2000);
            gatewayDelivered =
                socket.open(&network) == NSAPI_ERROR_OK &&
                socket.connect(gateway) == NSAPI_ERROR_OK &&
                sendAll(socket, request, static_cast<size_t>(requestLength));
            // VK: TX success only confirms delivery to the Windows gateway, not IoT Hub or Foundry.
            socket.close();
            if (gatewayDelivered) {
                statusLed = !statusLed;
            }
            updateDisplay(
                loadPercent,
                coolingPercent,
                mode,
                temperatureC,
                temperatureValid,
                state,
                deficitDurationSeconds,
                gatewayDelivered);
        }

        // VK: Two samples per second are enough for a human-operated demo without flooding the gateway.
        ThisThread::sleep_for(500ms);
    }
}
