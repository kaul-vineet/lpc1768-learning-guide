# Verified Exact-Hardware Learning Resources

This catalogue is restricted to resources that explicitly name or demonstrate:

- mbed NXP LPC1768 module (`mbed-005.1` / OM11043)
- Original mbed Application Board (`MSI-0315B`, `mbed-014.1`, Revision B)

Resources for bare LPC1768 boards, the later Arduino-format Application Shield
(`MBED-016.1`), compatible clones, Nucleo boards, and similarly named university
carrier boards are excluded.

## How the resources fit the learning plan

| Plan stage | Goal | Exact-hardware resources |
|---|---|---|
| 1. Board orientation | Recognize the boards and onboard peripherals | Adafruit board overview |
| 2. Embedded foundations | Use the LCD, joystick, speaker, sensors, ADC and PWM | Tanvir PlatformIO examples, ase1590 examples |
| 3. Applied project | Combine multiple peripherals into one product | RANPW virtual pet |
| 4. Industrial sensing | Measure motion and temperature and apply local rules | Georgia Tech bubble-level and TempAlarm examples |
| 5. Azure connectivity | Send structured telemetry through Ethernet or a gateway | Wakaama/LwM2M project, Georgia Tech Ethernet examples |
| 6. AI maintenance copilot | Add Azure AI explanations above deterministic logic | Our planned Azure IoT and Azure AI Foundry implementation |

## Verified university resources

### Georgia Institute of Technology - ECE 4180 / ECE 2036

Professor Jim Hamblen published multiple examples using the exact Application
Board pinout and libraries. Source-level evidence includes
`MMA7660 MMA(p28, p27)`, `LM75B tmp(p28, p27)`, the C12832 LCD, and the onboard
Ethernet connection.

- [Archived Bubble Level source](https://web.archive.org/web/20240713104112/https://os.mbed.com/users/4180_1/code/app-board-Bubble-Level/file/bd0546063b0a/main.cpp/)
- [Georgia Tech mbed course information](https://hamblen.ece.gatech.edu/mbed/mbedinfo.htm)
- [Georgia Tech student project collection](https://hamblen.ece.gatech.edu/489X/)
- Original retired repositories:
  - `https://os.mbed.com/users/4180_1/code/app-board-Bubble-Level/`
  - `https://os.mbed.com/users/4180_1/code/app-board-Ethernet-Websocket/`
  - `https://os.mbed.com/users/4180_1/code/app_board-NTPclock/`
  - `https://os.mbed.com/users/4180_1/code/app-board-RTOS-Threads/`
  - `https://os.mbed.com/users/4180_1/code/app-board-TempAlarm/`

These examples use Mbed 2 and retired online services. They are reference
material and require review or porting before use.

### University of Pennsylvania - ESE 519

The ESE 519 `app-board-RGB` laboratory repository uses PWM pins `p23`, `p24`,
and `p25`, exactly matching the MSI-0315B common-anode RGB LED.

- [Wayback Machine captures](https://web.archive.org/web/*/https://os.mbed.com/teams/ESE519/code/app-board-RGB/)
- Original retired repository:
  `https://os.mbed.com/teams/ESE519/code/app-board-RGB/`

No explicit reuse license was found for the university examples. Preserve
attribution and treat the material as educational reference unless the author
grants broader reuse.

## Verified project and code resources

| Project | What it demonstrates | Framework | Resource |
|---|---|---|---|
| Tanvir Ahmed Application Board projects | LCD, bubble level, joystick game, RGB LED, pots, speaker, USB HID and serial | PlatformIO with Mbed framework | [GitHub](https://github.com/tanvir-a0/Mbed-Application-Board-with-NXP-LPC1768-in-PlatformIO) |
| RANPW | Virtual pet, games, LCD, joystick, pots, LM75B, MMA7660 and flash persistence | Mbed CE | [GitHub](https://github.com/Magform/ranpw), [Hackster](https://www.hackster.io/magform/ranpw-a-dynamic-tamagotchi-inspired-device-168393) |
| MBED Application Board examples | LCD, serial, USB keyboard/mouse, bubble level and speaker | PlatformIO/Mbed | [GitHub](https://github.com/ase1590/MBED-Application-board-examples), [local copy](examples/MBED-Application-board-examples/) |
| Wakaama Application Board | LCD, temperature, accelerometer, RGB LED, joystick, Ethernet and LwM2M/CoAP | Mbed 2 | [GitHub](https://github.com/sbernard31/wakaama-mbed-application-board), [local copy](examples/wakaama-mbed-application-board/) |

## Verified videos

| Video | Demonstration |
|---|---|
| [Playing sound on the mbed Application Board](https://www.youtube.com/watch?v=fMo4JPLMg6s) | Onboard speaker/audio |
| [Bubble level on the mbed Application Board](https://www.youtube.com/watch?v=iCfgoiwhTu8) | MMA7660 accelerometer and LCD |
| [Controlling a mouse with the Application Board](https://www.youtube.com/watch?v=yGFc1OoId2w) | Accelerometer/controls and USB HID |
| [RANPW project demonstration](https://www.youtube.com/watch?v=-dkSjBSLyIo) | Multi-peripheral Mbed CE project |
| [Adafruit Application Board overview](https://www.youtube.com/watch?v=jAvPvzWCaPo) | Exact-board orientation and features |

## Academic-paper status

No publicly verifiable academic paper was found that clearly uses both exact
boards. Search results involving bare LPC1768 evaluation boards, custom
university boards, compatible clones, or the later Application Shield were not
added to this plan.

