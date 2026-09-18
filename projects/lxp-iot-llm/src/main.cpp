#include "mbed.h"
#include "EthernetInterface.h"
#include "TCPSocket.h"
#include "C12832A1Z.h"
#include <atomic>

using namespace std::chrono_literals;

namespace {
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

enum class RiskState {
    Normal,
    Warning,
    Critical
};

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
            return previousPercent;
        }
    }
    return percent > 100U ? 100U : percent;
}

void drawBar(int y, unsigned value)
{
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

    lcd.display(criticalBlink ? INVERT : DEFAULT);
    lcd.fillrect(0, 0, 127, 31, WHITE);

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
    lcd.update(MANUAL);
    while (true) {
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
    return temperatureC >= -55.0f && temperatureC <= 125.0f;
}

bool sendAll(TCPSocket &socket, const char *data, size_t length)
{
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
    temperatureBus.frequency(100000);
    joystickThread.start(joystickTask);
    displayThread.start(displayTask);

    EthernetInterface network;
    network.set_network(
        SocketAddress(boardIp),
        SocketAddress(netmask),
        SocketAddress(routerIp));
    while (network.connect() != NSAPI_ERROR_OK) {
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

        RiskState state = RiskState::Normal;
        if (loadPercent >= 85 && coolingPercent < loadPercent) {
            state = RiskState::Critical;
        } else if (loadPercent >= 70 || coolingPercent < loadPercent) {
            state = RiskState::Warning;
        }

        float temperatureC = 0.0f;
        const bool temperatureValid = readTemperature(temperatureC);
        const uint64_t nowMs = millisecondsSinceBoot();
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
            snprintf(temperatureValue, sizeof(temperatureValue), "null");
        }

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

        ThisThread::sleep_for(500ms);
    }
}
