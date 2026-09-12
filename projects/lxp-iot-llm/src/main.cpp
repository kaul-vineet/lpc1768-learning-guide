#include "mbed.h"
#include "USBSerial.h"

using namespace std::chrono_literals;

DigitalOut statusLed(LED1);
AnalogIn simulatedLoad(p19);
USBSerial usbSerial;

int main()
{
    unsigned long sequence = 0;

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

        usbSerial.printf(
            "{\"deviceId\":\"lpc1768-01\",\"loadPercent\":%u,"
            "\"state\":\"%s\",\"sequence\":%lu}\r\n",
            loadPercent,
            state,
            sequence++);

        statusLed = !statusLed;
        ThisThread::sleep_for(500ms);
    }
}
