import "dotenv/config";
import express, {
  type NextFunction,
  type Request,
  type Response
} from "express";
import { createSocket, type Socket as UdpSocket } from "node:dgram";
import path from "node:path";
import { fileURLToPath } from "node:url";
import azureIotDevice from "azure-iot-device";
import azureIotMqtt from "azure-iot-device-mqtt";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

const { Client, Message } = azureIotDevice;
const { Mqtt } = azureIotMqtt;

// VK: These shared types keep physical telemetry, cloud messages, and dashboard rendering on one vocabulary.
type MachineState = "normal" | "warning" | "critical";
type LinkState = "ready" | "offline" | "error";
type OperatingMode = "normal" | "boost" | "maintenance";
type Trend = "rising" | "falling" | "stable" | "unknown";
type Pattern = "balanced" | "transient-deficit" | "sustained-deficit";

interface IncomingTelemetry {
  // VK: Incoming telemetry contains device facts and the device's authoritative deterministic state.
  deviceId: string;
  loadPercent: number;
  coolingPercent: number;
  mode: OperatingMode;
  temperatureC: number | null;
  temperatureValid: boolean;
  state: MachineState;
  sequence: number;
  timestamp: string;
  source: "board" | "simulator";
}

interface Analysis {
  // VK: Analysis is gateway-derived evidence; risk is copied from the validated device decision.
  headroom: number;
  loadTrend: Trend;
  coolingTrend: Trend;
  temperatureTrend: Trend;
  deficitDurationSeconds: number;
  pattern: Pattern;
  risk: MachineState;
}

interface Telemetry extends IncomingTelemetry {
  analysis: Analysis;
}

interface Incident {
  // VK: An incident freezes the values that triggered Foundry so later live readings cannot rewrite history.
  id: string;
  timestamp: string;
  event: "state-change" | "mode-change";
  from: MachineState;
  to: MachineState;
  loadPercent: number;
  coolingPercent: number;
  mode: OperatingMode;
  headroom: number;
  explanation?: IncidentExplanation;
}

interface IncidentExplanation {
  // VK: The five fields form the strict human-facing contract expected from Foundry.
  assessment: string;
  contributingFactors: string[];
  recommendedAction: string;
  expectedRecovery: string;
  limitation: string;
  promptVersion: string;
}

interface DashboardState {
  // VK: One state object is broadcast to every browser so cards cannot drift out of sync.
  telemetry: Telemetry;
  history: Telemetry[];
  incidents: Incident[];
  logs: string[];
  links: {
    board: LinkState;
    iotHub: LinkState;
    foundry: LinkState;
  };
  cloud: {
    lastSentAt: string | null;
    lastError: string | null;
    messagesSent: number;
  };
}

// VK: Environment variables keep deployment choices and secrets outside the submitted source.
const port = Number(process.env.PORT ?? 8080);
const cloudIntervalMs = Number(process.env.CLOUD_INTERVAL_MS ?? 30_000);
const simulatorEnabled = process.env.ENABLE_SIMULATOR !== "false";
const simulatorCloudEnabled = process.env.ENABLE_SIMULATOR_CLOUD === "true";
const serialPreference = process.env.SERIAL_PORT ?? "auto";
const serialBaud = Number(process.env.SERIAL_BAUD ?? 115200);
const boardDeviceId = process.env.DEVICE_ID ?? "lpc1768-01";
const deviceTransport = process.env.DEVICE_TRANSPORT ?? "ethernet";
const udpPort = Number(process.env.UDP_PORT ?? 41234);
const promptVersion = "edgeops-multicontrol-v1";

// VK: The initial simulator-shaped value lets the UI render honestly before the first physical message arrives.
const initialTelemetry: Telemetry = {
  deviceId: boardDeviceId,
  loadPercent: 0,
  coolingPercent: 0,
  mode: "normal",
  temperatureC: null,
  temperatureValid: false,
  state: "normal",
  sequence: 0,
  timestamp: new Date().toISOString(),
  source: "simulator",
  analysis: {
    headroom: 0,
    loadTrend: "unknown",
    coolingTrend: "unknown",
    temperatureTrend: "unknown",
    deficitDurationSeconds: 0,
    pattern: "balanced",
    risk: "normal"
  }
};

// VK: This in-memory dashboard is intentionally lightweight; the prototype does not claim durable storage.
const dashboard: DashboardState = {
  telemetry: initialTelemetry,
  history: [initialTelemetry],
  incidents: [],
  logs: [],
  links: {
    board: "offline",
    iotHub: process.env.IOT_HUB_DEVICE_CONNECTION_STRING ? "offline" : "error",
    foundry: process.env.FOUNDRY_API_KEY ? "ready" : "error"
  },
  cloud: {
    lastSentAt: null,
    lastError: null,
    messagesSent: 0
  }
};

// VK: SSE clients receive the same authoritative snapshot whenever any layer changes.
const clients = new Set<Response>();
let previousState: MachineState = "normal";
let lastCloudSend = 0;
let cloudSendQueue: Promise<void> = Promise.resolve();
let iotClient: ReturnType<typeof Client.fromConnectionString> | null = null;
let activeSerialPort: SerialPort | null = null;
let activeUdpSocket: UdpSocket | null = null;
let udpBoardSeen = false;
let lastBoardReceivedAt = 0;
let previousTelemetry: Telemetry | null = null;
let previousMode: OperatingMode = "normal";
let deficitStartedAt: number | null = null;

function log(message: string): void {
  // VK: Keep a short operator-friendly history while still writing the complete event to the console.
  const entry = `${new Date().toLocaleTimeString("en-GB", { hour12: false })}  ${message}`;
  dashboard.logs.unshift(entry);
  dashboard.logs = dashboard.logs.slice(0, 12);
  console.log(entry);
}

function broadcast(): void {
  // VK: Server-sent events are sufficient because this dashboard only needs one-way live updates.
  const payload = `data: ${JSON.stringify(dashboard)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

function determineState(loadPercent: number, coolingPercent: number): MachineState {
  // VK: Keep this identical to the firmware rule so corrupted or inconsistent telemetry is rejected.
  if (loadPercent >= 85 && coolingPercent < loadPercent) {
    return "critical";
  }
  if (loadPercent >= 70 || coolingPercent < loadPercent) {
    return "warning";
  }
  return "normal";
}

function validateTelemetry(input: unknown, source: IncomingTelemetry["source"]): IncomingTelemetry {
  // VK: Treat every transport as untrusted input, including messages that originated from our own simulator.
  if (!input || typeof input !== "object") {
    throw new Error("Telemetry must be a JSON object");
  }

  const candidate = input as Record<string, unknown>;
  const loadPercent = Number(candidate.loadPercent);
  const coolingPercent = Number(candidate.coolingPercent);
  const sequence = Number(candidate.sequence);
  const state = candidate.state;
  const deviceId = candidate.deviceId;
  const mode = candidate.mode;
  const temperatureValid = candidate.temperatureValid;

  if (typeof deviceId !== "string" || deviceId.length < 1 || deviceId.length > 64) {
    throw new Error("Invalid deviceId");
  }
  if (!Number.isFinite(loadPercent) || loadPercent < 0 || loadPercent > 100) {
    throw new Error("loadPercent must be between 0 and 100");
  }
  if (!Number.isFinite(coolingPercent) || coolingPercent < 0 || coolingPercent > 100) {
    throw new Error("coolingPercent must be between 0 and 100");
  }
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error("sequence must be a non-negative integer");
  }
  if (mode !== "normal" && mode !== "boost" && mode !== "maintenance") {
    throw new Error("Invalid operating mode");
  }
  if (typeof temperatureValid !== "boolean") {
    throw new Error("temperatureValid must be boolean");
  }

  let temperatureC: number | null = null;
  if (temperatureValid) {
    // VK: Validity and value must agree; silently substituting a temperature would create false evidence.
    if (typeof candidate.temperatureC !== "number") {
      throw new Error("temperatureC must be numeric when valid");
    }
    temperatureC = candidate.temperatureC;
    if (!Number.isFinite(temperatureC) || temperatureC < -55 || temperatureC > 125) {
      throw new Error("temperatureC must be between -55 and 125 when valid");
    }
    temperatureC = Math.round(temperatureC * 10) / 10;
  } else if (candidate.temperatureC !== null) {
    throw new Error("temperatureC must be null when temperatureValid is false");
  }

  if (state !== "normal" && state !== "warning" && state !== "critical") {
    throw new Error("Invalid machine state");
  }

  const deterministicState = determineState(loadPercent, coolingPercent);
  // VK: The gateway validates the device decision; it never quietly replaces it with a cloud decision.
  if (state !== deterministicState) {
    throw new Error(`State ${state} disagrees with deterministic risk ${deterministicState}`);
  }

  return {
    deviceId,
    loadPercent: Math.round(loadPercent),
    coolingPercent: Math.round(coolingPercent),
    mode,
    temperatureC,
    temperatureValid,
    state,
    sequence,
    timestamp: new Date().toISOString(),
    source
  };
}

function runValidationSelfCheck(): void {
  // VK: Fail at startup if a future edit weakens the telemetry contract or deterministic-state check.
  validateTelemetry(
    {
      deviceId: "self-test",
      loadPercent: 50,
      coolingPercent: 60,
      mode: "normal",
      temperatureC: 25,
      temperatureValid: true,
      state: "normal",
      sequence: 0
    },
    "simulator"
  );

  const invalidMessages = [
    {
      deviceId: "self-test", loadPercent: -1, coolingPercent: 60, mode: "normal",
      temperatureC: 25, temperatureValid: true, state: "normal", sequence: 1
    },
    {
      deviceId: "self-test", loadPercent: 88, coolingPercent: 30, mode: "normal",
      temperatureC: 25, temperatureValid: true, state: "normal", sequence: 2
    },
    {
      deviceId: "", loadPercent: 50, coolingPercent: 60, mode: "normal",
      temperatureC: 25, temperatureValid: true, state: "normal", sequence: 3
    },
    {
      deviceId: "self-test", loadPercent: 50, coolingPercent: 60, mode: "invalid",
      temperatureC: 25, temperatureValid: true, state: "normal", sequence: 4
    },
    {
      deviceId: "self-test", loadPercent: 50, coolingPercent: 60, mode: "normal",
      temperatureC: null, temperatureValid: true, state: "normal", sequence: 5
    }
  ];

  for (const message of invalidMessages) {
    let rejected = false;
    try {
      validateTelemetry(message, "simulator");
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`Telemetry validator accepted invalid self-test message: ${JSON.stringify(message)}`);
    }
  }
  log("Telemetry validator self-check passed");
}

async function openIoTHub(): Promise<void> {
  // VK: Azure credentials remain on the gateway PC and are never compiled into LPC1768 firmware.
  const connectionString = process.env.IOT_HUB_DEVICE_CONNECTION_STRING;
  if (!connectionString) {
    log("IoT Hub connection string is not configured");
    dashboard.links.iotHub = "error";
    return;
  }

  iotClient = Client.fromConnectionString(connectionString, Mqtt);
  await new Promise<void>((resolve, reject) => {
    iotClient?.open((error) => (error ? reject(error) : resolve()));
  });
  dashboard.links.iotHub = "ready";
  log("IoT Hub connection ready");
}

async function sendToIoTHub(telemetry: Telemetry): Promise<void> {
  if (!iotClient) {
    throw new Error("IoT Hub client is unavailable");
  }

  const message = new Message(JSON.stringify(telemetry));
  // VK: Message properties make state, mode, and source available for routing without parsing the JSON body.
  message.contentType = "application/json";
  message.contentEncoding = "utf-8";
  message.properties.add("state", telemetry.state);
  message.properties.add("mode", telemetry.mode);
  message.properties.add("source", telemetry.source);

  await new Promise<void>((resolve, reject) => {
    iotClient?.sendEvent(message, (error) => (error ? reject(error) : resolve()));
  });
  dashboard.links.iotHub = "ready";
  dashboard.cloud.lastSentAt = new Date().toISOString();
  dashboard.cloud.lastError = null;
  dashboard.cloud.messagesSent += 1;
  log(`IoT Hub accepted sequence ${telemetry.sequence}`);
}

function enqueueIoTHubSend(telemetry: Telemetry): Promise<boolean> {
  // VK: Queue sends so a WARNING or CRITICAL transition cannot disappear behind an in-flight heartbeat.
  const send = cloudSendQueue.then(async () => {
    try {
      await sendToIoTHub(telemetry);
      return true;
    } catch (error) {
      dashboard.links.iotHub = "error";
      dashboard.cloud.lastError = error instanceof Error ? error.message : String(error);
      log(`IoT Hub error: ${dashboard.cloud.lastError}`);
      return false;
    } finally {
      broadcast();
    }
  });
  cloudSendQueue = send.then(() => undefined);
  return send;
}

function trend(current: number, previous: number | undefined, deadband: number): Trend {
  // VK: A deadband prevents one-point measurement noise from being narrated as a meaningful trend.
  if (previous === undefined) {
    return "unknown";
  }
  const change = current - previous;
  if (change > deadband) {
    return "rising";
  }
  if (change < -deadband) {
    return "falling";
  }
  return "stable";
}

function analyzeTelemetry(input: IncomingTelemetry): Telemetry {
  // VK: These are transparent calculations over device facts, not a second risk classifier.
  const comparablePrevious =
    previousTelemetry?.source === input.source ? previousTelemetry : null;
  if (!comparablePrevious) {
    deficitStartedAt = null;
  }

  const headroom = input.coolingPercent - input.loadPercent;
  const now = Date.parse(input.timestamp);
  if (headroom < 0) {
    deficitStartedAt ??= now;
  } else {
    deficitStartedAt = null;
  }
  const deficitDurationSeconds =
    deficitStartedAt === null ? 0 : Math.max(0, Math.floor((now - deficitStartedAt) / 1000));
  const temperatureTrend =
    input.temperatureValid && comparablePrevious?.temperatureValid
      ? trend(input.temperatureC ?? 0, comparablePrevious.temperatureC ?? undefined, 0.2)
      : "unknown";

  return {
    ...input,
    analysis: {
      headroom,
      loadTrend: trend(input.loadPercent, comparablePrevious?.loadPercent, 1),
      coolingTrend: trend(input.coolingPercent, comparablePrevious?.coolingPercent, 1),
      temperatureTrend,
      deficitDurationSeconds,
      pattern:
        headroom >= 0
          ? "balanced"
          : deficitDurationSeconds >= 10
            ? "sustained-deficit"
            : "transient-deficit",
      risk: input.state
    }
  };
}

function normalizeExplanation(raw: string): IncidentExplanation {
  // VK: Validate the model output again locally even though Azure is asked for strict structured JSON.
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  const contributingFactors = parsed.contributingFactors;
  if (
    typeof parsed.assessment !== "string" ||
    !Array.isArray(contributingFactors) ||
    contributingFactors.length < 1 ||
    contributingFactors.length > 5 ||
    !contributingFactors.every((factor) => typeof factor === "string") ||
    typeof parsed.recommendedAction !== "string" ||
    typeof parsed.expectedRecovery !== "string" ||
    typeof parsed.limitation !== "string"
  ) {
    throw new Error("Foundry explanation did not match the required schema");
  }
  return {
    assessment: parsed.assessment,
    contributingFactors,
    recommendedAction: parsed.recommendedAction,
    expectedRecovery: parsed.expectedRecovery,
    limitation: parsed.limitation,
    promptVersion
  };
}

async function explainIncident(telemetry: Telemetry): Promise<IncidentExplanation> {
  // VK: Foundry configuration is mandatory for explanation, but never for local sensing or risk decisions.
  const endpoint = process.env.FOUNDRY_ENDPOINT;
  const deployment = process.env.FOUNDRY_DEPLOYMENT;
  const apiVersion = process.env.FOUNDRY_API_VERSION ?? "2024-10-21";
  const apiKey = process.env.FOUNDRY_API_KEY;

  if (!endpoint || !deployment || !apiKey) {
    throw new Error("Foundry configuration is incomplete");
  }

  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
    {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        // VK: Foundry receives a closed evidence set and an authoritative risk; it is an explanation layer only.
        messages: [
          {
            role: "system",
            content:
              `Prompt version: ${promptVersion}. You are an industrial incident explanation assistant for a ` +
              "hackathon simulation. loadPercent is simulated equipment demand. coolingPercent is simulated " +
              "available cooling capacity. capacity headroom equals cooling minus load; negative headroom means " +
              "demand exceeds capacity. NORMAL is standard operation, BOOST means corrective cooling action is " +
              "active, and MAINTENANCE means intentionally restricted operation. Temperature is supporting " +
              "ambient evidence only. The supplied deterministic risk is authoritative: never recalculate or " +
              "override it. Use only supplied evidence, distinguish facts from hypotheses, never invent a " +
              "measurement or fault, and never issue a device command. Return only concise valid JSON with " +
              "assessment (string), contributingFactors (1-5 short strings), recommendedAction (string), " +
              "expectedRecovery (string), and limitation (string)."
          },
          {
            role: "user",
            content: JSON.stringify({
              task:
                "Explain the operational condition, identify the primary contributing factors, suggest one safe human check or simulated adjustment, and state what evidence would indicate recovery.",
              evidence: {
                deviceId: telemetry.deviceId,
                loadPercent: telemetry.loadPercent,
                coolingPercent: telemetry.coolingPercent,
                operatingMode: telemetry.mode,
                temperatureC: telemetry.temperatureC,
                temperatureValid: telemetry.temperatureValid,
                capacityHeadroom: telemetry.analysis.headroom,
                deficitDurationSeconds: telemetry.analysis.deficitDurationSeconds,
                loadTrend: telemetry.analysis.loadTrend,
                coolingTrend: telemetry.analysis.coolingTrend,
                temperatureTrend: telemetry.analysis.temperatureTrend,
                pattern: telemetry.analysis.pattern,
                deterministicRisk: telemetry.analysis.risk
              }
            })
          }
        ],
        response_format: {
          // VK: Strict schema output avoids fragile parsing and prevents missing safety or limitation fields.
          type: "json_schema",
          json_schema: {
            name: "edgeops_incident_assessment",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                assessment: { type: "string" },
                contributingFactors: {
                  type: "array",
                  minItems: 1,
                  maxItems: 5,
                  items: { type: "string" }
                },
                recommendedAction: { type: "string" },
                expectedRecovery: { type: "string" },
                limitation: { type: "string" }
              },
              required: [
                "assessment",
                "contributingFactors",
                "recommendedAction",
                "expectedRecovery",
                "limitation"
              ]
            }
          }
        },
        max_completion_tokens: 700,
        reasoning_effort: "minimal"
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Foundry returned HTTP ${response.status}: ${await response.text()}`);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Foundry returned no explanation content");
  }

  dashboard.links.foundry = "ready";
  return normalizeExplanation(content);
}

async function processTelemetry(input: IncomingTelemetry): Promise<void> {
  // VK: Update the live dashboard first; cloud work is slower and must not delay local visibility.
  const telemetry = analyzeTelemetry(input);
  dashboard.telemetry = telemetry;
  dashboard.history.push(telemetry);
  dashboard.history = dashboard.history.slice(-120);

  const sourceChanged =
    previousTelemetry !== null && telemetry.source !== previousTelemetry.source;
  const stateChanged = !sourceChanged && telemetry.state !== previousState;
  const modeChanged = !sourceChanged && telemetry.mode !== previousMode;
  // VK: Ask the LLM about meaningful transitions, not every small movement of a physical knob.
  const explanationRequested = stateChanged || (modeChanged && telemetry.state !== "normal");
  let incident: Incident | undefined;
  if (explanationRequested) {
    // VK: Capture the transition values now because the next physical sample may arrive before Foundry responds.
    incident = {
      id: `${telemetry.sequence}-${Date.now()}`,
      timestamp: telemetry.timestamp,
      event: stateChanged ? "state-change" : "mode-change",
      from: previousState,
      to: telemetry.state,
      loadPercent: telemetry.loadPercent,
      coolingPercent: telemetry.coolingPercent,
      mode: telemetry.mode,
      headroom: telemetry.analysis.headroom
    };
    dashboard.incidents.unshift(incident);
    dashboard.incidents = dashboard.incidents.slice(0, 20);
    if (stateChanged) {
      log(`State changed ${previousState.toUpperCase()} -> ${telemetry.state.toUpperCase()}`);
    } else {
      log(`Operating mode changed ${previousMode.toUpperCase()} -> ${telemetry.mode.toUpperCase()}`);
    }
  }
  if (sourceChanged) {
    log(`Telemetry source changed to ${telemetry.source.toUpperCase()}`);
  }
  previousState = telemetry.state;
  previousMode = telemetry.mode;
  previousTelemetry = telemetry;

  // VK: Browsers can immediately see the edge transition while IoT Hub and Foundry continue asynchronously.
  broadcast();

  // VK: Physical messages may use cloud services; simulator traffic remains local unless explicitly enabled.
  const cloudAllowed = telemetry.source === "board" || simulatorCloudEnabled;
  const cloudDue = Date.now() - lastCloudSend >= cloudIntervalMs;
  let deliveredToIoTHub = false;
  if (cloudAllowed && (cloudDue || explanationRequested)) {
    lastCloudSend = Date.now();
    deliveredToIoTHub = await enqueueIoTHubSend(telemetry);
  }

  if (cloudAllowed && incident && deliveredToIoTHub) {
    // VK: Preserve the demo's causal order: IoT delivers the incident before Foundry explains it.
    try {
      log(`Requesting Foundry explanation for ${incident.event}`);
      incident.explanation = await explainIncident(telemetry);
      log("Foundry explanation received");
    } catch (error) {
      dashboard.links.foundry = "error";
      log(`Foundry error: ${error instanceof Error ? error.message : String(error)}`);
    }
    broadcast();
  } else if (cloudAllowed && incident) {
    log(`Foundry skipped because IoT Hub did not accept sequence ${telemetry.sequence}`);
    broadcast();
  }
}

async function chooseSerialPort(): Promise<string | null> {
  // VK: Serial remains a supported fallback even though Ethernet HTTP is the validated physical path.
  if (serialPreference !== "auto") {
    return serialPreference;
  }

  const ports = await SerialPort.list();
  const nativeUsb = ports.find(
    (candidate) =>
      candidate.vendorId?.toLowerCase() === "1f00" ||
      candidate.manufacturer?.toLowerCase().includes("mbed") ||
      candidate.pnpId?.toLowerCase().includes("usb serial")
  );
  return nativeUsb?.path ?? null;
}

async function startSerial(): Promise<boolean> {
  // VK: This adapter validates serial JSON through the same contract used by Ethernet and UDP.
  const serialPath = await chooseSerialPort();
  if (!serialPath) {
    log("No compatible COM port detected");
    dashboard.links.board = "offline";
    return false;
  }

  activeSerialPort = new SerialPort({ path: serialPath, baudRate: serialBaud });
  const parser = activeSerialPort.pipe(new ReadlineParser({ delimiter: "\n" }));

  activeSerialPort.on("open", () => {
    activeSerialPort?.set({ dtr: true, rts: true }, (error) => {
      if (error) {
        dashboard.links.board = "error";
        log(`Could not assert serial ready signals: ${error.message}`);
      } else {
        dashboard.links.board = "ready";
        log(`Board connected on ${serialPath}`);
      }
      broadcast();
    });
  });
  activeSerialPort.on("error", (error) => {
    dashboard.links.board = "error";
    log(`Serial error: ${error.message}`);
    broadcast();
  });
  activeSerialPort.on("close", () => {
    dashboard.links.board = "offline";
    log("Board serial connection closed");
    broadcast();
  });
  parser.on("data", (line: string) => {
    try {
      const parsed: unknown = JSON.parse(line.trim());
      const serialMessage =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? { ...(parsed as Record<string, unknown>), deviceId: boardDeviceId }
          : parsed;
      const telemetry = validateTelemetry(serialMessage, "board");
      void processTelemetry(telemetry);
    } catch (error) {
      log(`Rejected serial message: ${error instanceof Error ? error.message : String(error)}`);
      broadcast();
    }
  });
  return true;
}

function startUdp(): void {
  // VK: UDP support is retained for experiments; the submitted firmware currently posts HTTP telemetry.
  activeUdpSocket = createSocket("udp4");
  activeUdpSocket.on("error", (error) => {
    dashboard.links.board = "error";
    log(`UDP listener error: ${error.message}`);
    broadcast();
  });
  activeUdpSocket.on("message", (message, remote) => {
    try {
      const parsed: unknown = JSON.parse(message.toString("utf8"));
      const udpMessage =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? { ...(parsed as Record<string, unknown>), deviceId: boardDeviceId }
          : parsed;
      const telemetry = validateTelemetry(udpMessage, "board");
      lastBoardReceivedAt = Date.now();
      if (!udpBoardSeen) {
        udpBoardSeen = true;
        dashboard.links.board = "ready";
        log(`Board telemetry received over UDP from ${remote.address}:${remote.port}`);
      }
      void processTelemetry(telemetry);
    } catch (error) {
      log(`Rejected UDP message: ${error instanceof Error ? error.message : String(error)}`);
      broadcast();
    }
  });
  activeUdpSocket.bind(udpPort, "0.0.0.0", () => {
    log(`Listening for board telemetry on UDP ${udpPort}`);
  });
}

function startSimulator(): void {
  // VK: The simulator keeps the UI demonstrable, but its source label prevents it being mistaken for hardware.
  log("Simulator active while waiting for the physical board");
  if (!simulatorCloudEnabled) {
    log("Simulator cloud traffic is disabled to protect the daily quota");
  }
  let sequence = 1;
  setInterval(() => {
    // VK: Physical telemetry always wins; simulation resumes only after an eight-second silence.
    if (Date.now() - lastBoardReceivedAt <= 8_000) {
      return;
    }
    if (dashboard.telemetry.source === "board") {
      udpBoardSeen = false;
      dashboard.links.board = "offline";
      log("Board telemetry timed out after 8 seconds; simulator resumed");
    }
    const cycle = sequence % 80;
    let loadPercent: number;
    let coolingPercent: number;
    let mode: OperatingMode;
    let temperatureC: number;
    if (cycle < 20) {
      loadPercent = 45;
      coolingPercent = 65;
      mode = "normal";
      temperatureC = 26;
    } else if (cycle < 40) {
      loadPercent = Math.round(55 + (cycle - 20) * 1.5);
      coolingPercent = 45;
      mode = "normal";
      temperatureC = 26 + (cycle - 20) * 0.1;
    } else if (cycle < 50) {
      loadPercent = 88;
      coolingPercent = 38;
      mode = "normal";
      temperatureC = 28 + (cycle - 40) * 0.12;
    } else if (cycle < 65) {
      loadPercent = Math.round(80 - (cycle - 50) * 0.9);
      coolingPercent = Math.round(45 + (cycle - 50) * 3);
      mode = "boost";
      temperatureC = 29 - (cycle - 50) * 0.08;
    } else {
      loadPercent = 45;
      coolingPercent = 55;
      mode = "maintenance";
      temperatureC = 27;
    }
    const state = determineState(loadPercent, coolingPercent);
    const telemetry = validateTelemetry(
      {
        deviceId: boardDeviceId,
        loadPercent,
        coolingPercent,
        mode,
        temperatureC,
        temperatureValid: true,
        state,
        sequence: sequence++
      },
      "simulator"
    );
    void processTelemetry(telemetry);
  }, 1000);
}

const app = express();
app.disable("x-powered-by");
// VK: Board messages are intentionally small, so a 1 KB limit rejects accidental or abusive payloads early.
app.use(express.json({ limit: "1kb" }));
app.use(
  (
    error: unknown,
    _request: Request,
    response: Response,
    next: NextFunction
  ) => {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: unknown }).status)
        : undefined;
    if (error instanceof SyntaxError && status === 400) {
      // VK: Return a concise device-facing error instead of leaking a framework stack trace.
      log("Rejected malformed JSON telemetry");
      response.status(400).json({
        accepted: false,
        error: "Malformed JSON"
      });
      return;
    }
    next(error);
  }
);
app.post("/api/telemetry", (request, response) => {
  // VK: HTTP 202 means the gateway accepted the sample for processing, not that every cloud stage has finished.
  try {
    const input =
      request.body && typeof request.body === "object" && !Array.isArray(request.body)
        ? { ...(request.body as Record<string, unknown>), deviceId: boardDeviceId }
        : request.body;
    const telemetry = validateTelemetry(input, "board");
    lastBoardReceivedAt = Date.now();
    if (!udpBoardSeen) {
      udpBoardSeen = true;
      dashboard.links.board = "ready";
      log(`Board telemetry received over HTTP from ${request.ip}`);
    }
    void processTelemetry(telemetry);
    response.status(202).json({ accepted: true });
  } catch (error) {
    log(`Rejected HTTP telemetry: ${error instanceof Error ? error.message : String(error)}`);
    broadcast();
    response.status(400).json({ accepted: false, error: "Invalid telemetry" });
  }
});
app.get("/api/status", (_request, response) => response.json(dashboard));
app.get("/api/health", (_request, response) =>
  response.json({ status: "ok", source: dashboard.telemetry.source, links: dashboard.links })
);
app.get("/events", (request, response) => {
  // VK: New browsers receive the full current state immediately, then incremental full-state broadcasts.
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders();
  clients.add(response);
  response.write(`data: ${JSON.stringify(dashboard)}\n\n`);
  request.on("close", () => clients.delete(response));
});

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const webDirectory = path.resolve(currentDirectory, "../web-dist");
// VK: The gateway serves the built React app so one process hosts both APIs and the demo screen.
app.use(express.static(webDirectory));
app.get("/{*path}", (_request, response) => response.sendFile(path.join(webDirectory, "index.html")));

async function main(): Promise<void> {
  // VK: Validate local assumptions before opening transports or accepting a physical message.
  runValidationSelfCheck();

  try {
    await openIoTHub();
  } catch (error) {
    dashboard.links.iotHub = "error";
    log(`IoT Hub startup error: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (deviceTransport === "ethernet") {
    startUdp();
    if (simulatorEnabled) {
      startSimulator();
    }
  } else {
    const serialStarted = await startSerial().catch((error) => {
      dashboard.links.board = "error";
      log(`Serial startup error: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    });
    if (!serialStarted && simulatorEnabled) {
      startSimulator();
    }
  }

  if (deviceTransport !== "ethernet" && deviceTransport !== "serial") {
    throw new Error(`Unsupported DEVICE_TRANSPORT: ${deviceTransport}`);
  }

  if (!simulatorEnabled && deviceTransport === "ethernet") {
    log("Waiting for physical board telemetry");
  }

  app.listen(port, () => log(`Dashboard available at http://localhost:${port}`));
}

void main();
