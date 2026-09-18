# Physical Signals to AI Guidance: Validated Learnings

This document records the engineering conclusions proven while building and
physically testing the LPC1768 IoT-to-LLM decision-support prototype. It is a
companion to [the implementation tutorial](EDGEOPS-86-MVP.md), not a replacement
for it.

## Proven architecture

```text
physical controls and sensors
             |
             v
LPC1768 deterministic decision
             |
        Ethernet HTTP
             |
             v
Windows gateway ---------> live dashboard
      |
      +--send-----------> Azure IoT Hub
      |
      +--after successful IoT delivery--> Azure AI Foundry
                                           |
                                           v
                                  grounded explanation
```

The responsibility boundary is the most important result:

- The device senses load, cooling capacity, temperature, and operating mode.
- The LPC1768 assigns the authoritative NORMAL, WARNING, or CRITICAL state.
- The gateway validates the message and derives mathematical evidence.
- Azure IoT Hub accepts the telemetry and decision before an incident is sent
  to Foundry for explanation.
- Azure AI Foundry is the LLM intelligence layer. It explains supplied
  evidence, recommends a human-reviewed action, and defines recovery evidence.
- Foundry does not classify risk, issue device commands, or override firmware.
- A human remains responsible for operational action.

This pattern keeps time-sensitive safety behavior deterministic and available
without cloud connectivity while using an LLM where probabilistic reasoning is
valuable: correlating evidence and communicating it clearly.

## Hardware behavior confirmed on the physical board

| Function | Confirmed behavior |
|---|---|
| Left potentiometer `p19` | Controls simulated equipment load |
| Right potentiometer `p20` | Controls simulated cooling capacity |
| Joystick `p15` | Selects and latches BOOST |
| Joystick `p12` | Selects and latches MAINTENANCE |
| Joystick centre `p14` | Returns to NORMAL |
| LM75B on `p28/p27` | Reports plausible ambient temperature |
| C12832 LCD | Shows local values, alert overrides, blink, and gateway-send status |
| Application Board Ethernet | Reliably carries HTTP telemetry to the Windows gateway |

The joystick switches on the tested MSI-0315B / mbed-014.1 Revision-B board are
active-high. Reliable firmware configuration is `PullDown`, with a reading of
`1` treated as pressed. A dedicated 20 ms polling thread is required because
momentary presses can occur while the legacy network stack is blocking.

## Analog-input stabilization

Reading `p19` and `p20` back-to-back initially allowed visible cross-channel
movement and noise. Stable physical readings required:

1. Discarding the first ADC reading after selecting a channel.
2. Waiting 100 microseconds for channel settling.
3. Averaging 16 samples separated by 50 microseconds.
4. Retaining the previous displayed percentage when the change is no more than
   one percentage point.

This is a reusable lesson for multiplexed ADC inputs: filtering cannot correct
an unsettled first conversion, so settling and averaging should be applied
together.

## Deterministic risk contract

```text
headroom = coolingPercent - loadPercent

CRITICAL: loadPercent >= 85 and headroom < 0
WARNING:  loadPercent >= 70 or headroom < 0
NORMAL:   otherwise
```

Temperature is supporting evidence only. Mode supplies operational context but
does not suppress a risk state.

A non-negative headroom value does not always mean NORMAL. For example, 90%
load and 92% cooling produces `+2` headroom but remains WARNING because load is
still above the 70% warning threshold. Full recovery requires both non-negative
headroom and load below 70%.

## Validated physical scenario

| Phase | Load | Cooling | Headroom | Result |
|---|---:|---:|---:|---|
| Baseline | 64% | 77% | +13 | NORMAL |
| Warning threshold | 71% | 73% | +2 | WARNING because load is at least 70% |
| Growing deficit | 84% | 73% | -11 | WARNING |
| Critical incident | 90% | 73% | -17 | CRITICAL |
| Partial recovery | 90% | 92% | +2 | WARNING because load remains high |
| Full recovery | 62% | 92% | +30 | NORMAL |

BOOST selection, recovery, return to NORMAL mode, IoT Hub delivery, and Foundry
explanations were all exercised with the physical board.

## Telemetry and display semantics

The device sends load, cooling, mode, temperature validity, temperature,
deterministic state, and sequence. The gateway derives headroom, trends,
deficit duration, and deficit pattern. Derived evidence is not sent back as a
control command.

`TX:OK` on the LCD means that the board sent its HTTP request to the Windows
gateway. It does not prove that IoT Hub accepted the event or that Foundry
completed an analysis. Those stages have separate indicators on the browser
dashboard.

If physical telemetry stops for eight seconds, the dashboard remains online
because it is hosted by the PC and a clearly labelled local simulator resumes.
Simulator cloud traffic is disabled by default. Simulator values must never be
presented as physical measurements.

## LPC1768 and legacy-stack constraints

- Native USB CDC repeatedly stalled after its first message on the tested
  LPC1768/Mbed combination. Ethernet HTTP is the validated telemetry path.
- The legacy TCP stack opens a connection per request, so physical updates can
  arrive several seconds apart. The LCD and joystick therefore run in
  independent threads.
- Floating-point `printf` support was unavailable: `%.1f` was emitted
  literally and produced malformed JSON. Temperature is formatted with
  integer tenths instead.
- Malformed JSON is rejected concisely by the gateway rather than generating a
  large framework stack trace.
- The final firmware uses approximately 25.3% of Flash and 20.7% of RAM.

## Foundry contract and timing

The controlled prompt is versioned as `edgeops-multicontrol-v1`. Azure strict
structured output uses `response_format: json_schema` and requires:

```json
{
  "assessment": "",
  "contributingFactors": [""],
  "recommendedAction": "",
  "expectedRecovery": "",
  "limitation": ""
}
```

Strict output was necessary because prompt instructions alone did not always
produce JSON matching the gateway schema.

Foundry is transition-driven rather than sample-driven. Its visible assessment
can therefore describe the incident snapshot that triggered analysis while the
live gauges have already moved. The user interface must distinguish current
telemetry from the analyzed transition instead of implying they are the same
instant.

Transition messages are serialized through an IoT Hub send queue so a new
WARNING, CRITICAL, recovery, or relevant mode event cannot be discarded while a
previous cloud send is in progress. Foundry analysis is requested only after
IoT Hub accepts that incident snapshot.

## Demonstration and communication lessons

The clearest narrative is:

> The device senses, the edge decides, IoT delivers, Foundry explains, and the
> human acts.

The strongest product framing is **IoT-to-LLM decision support**. It avoids
claiming autonomous AI control and makes Foundry's role explicit as the
intelligence and explanation layer.

For a short demonstration:

1. Establish NORMAL with positive headroom.
2. Cross the load threshold and let the edge visibly declare WARNING.
3. Allow IoT Hub delivery and the later Foundry update to appear as separate
   causal steps.
4. Increase demand to show an 11-point deficit.
5. Reach 90% load versus 73% cooling to show the 17-point CRITICAL deficit.
6. Explain that Foundry recommends action while the human remains in control.

The recorded source video is 67.9 seconds. Its physical-board sequence ends
when simulator fallback appears. The large video remains a local asset and is
not part of the Git corpus.

## Validated status

- [x] Firmware builds without warnings and fits the LPC1768.
- [x] Gateway and React dashboard build.
- [x] Both potentiometers work independently after ADC stabilization.
- [x] Active-high joystick input and mode latching work.
- [x] LM75B temperature reporting works.
- [x] C12832 local pages, alerts, blink, and TX status work.
- [x] Physical NORMAL, WARNING, CRITICAL, BOOST, partial recovery, and full
  recovery were demonstrated.
- [x] IoT Hub delivery was observed.
- [x] Strict Foundry WARNING, CRITICAL, BOOST, and recovery outputs were
  observed.
