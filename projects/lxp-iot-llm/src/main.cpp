#include "mbed.h"
#include "EthernetInterface.h"
#include "TCPSocket.h"

using namespace std::chrono_literals;

namespace {
constexpr char gatewayIp[] = "192.168.29.226";
constexpr uint16_t gatewayPort = 8080;
constexpr char boardIp[] = "192.168.29.240";
constexpr char netmask[] = "255.255.255.0";
constexpr char routerIp[] = "192.168.29.1";

DigitalOut statusLed(LED1);
AnalogIn simulatedLoad(p19);

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
    char body[128];
    char request[320];

    while (true) {
        unsigned loadPercent =
            static_cast<unsigned>(simulatedLoad.read() * 100.0f + 0.5f);
        if (loadPercent > 100) {
            loadPercent = 100;
        }

        const char *state = "normal";
        if (loadPercent >= 85) {
            state = "critical";
        } else if (loadPercent >= 70) {
            state = "warning";
        }

        const int bodyLength = snprintf(
            body,
            sizeof(body),
            "{\"deviceId\":\"lpc1768-01\",\"loadPercent\":%u,"
            "\"state\":\"%s\",\"sequence\":%lu}",
            loadPercent,
            state,
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
            const bool delivered =
                socket.open(&network) == NSAPI_ERROR_OK &&
                socket.connect(gateway) == NSAPI_ERROR_OK &&
                sendAll(socket, request, static_cast<size_t>(requestLength));
            socket.close();
            if (delivered) {
                statusLed = !statusLed;
            }
        }

        ThisThread::sleep_for(500ms);
    }
}
