import "dotenv/config";
import express, { type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import azureIotDevice from "azure-iot-device";
import azureIotMqtt from "azure-iot-device-mqtt";
import { SerialPort } from "serialport";
import { ReadlineParser } from "@serialport/parser-readline";

const { Client, Message } = azureIotDevice;
const { Mqtt } = azureIotMqtt;

type MachineState = "normal" | "warning" | "critical";
type LinkState = "ready" | "offline" | "error";

interface Telemetry {
  deviceId: string;
  loadPercent: number;
  state: MachineState;
  sequence: number;
  timestamp: string;
  source: "board" | "simulator";
}

interface Incident {
  id: string;
  timestamp: string;
  from: MachineState;
  to: MachineState;
  loadPercent: number;
  explanation?: IncidentExplanation;
}

interface IncidentExplanation {
  verifiedFacts: unknown;
  possibleCause: string;
  suggestedCheck: string;
  limitation: string;
}

interface DashboardState {
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

const port = Number(process.env.PORT ?? 8080);
const cloudIntervalMs = Number(process.env.CLOUD_INTERVAL_MS ?? 30_000);
const simulatorEnabled = process.env.ENABLE_SIMULATOR !== "false";
const simulatorCloudEnabled = process.env.ENABLE_SIMULATOR_CLOUD === "true";
const serialPreference = process.env.SERIAL_PORT ?? "auto";
const serialBaud = Number(process.env.SERIAL_BAUD ?? 115200);

const initialTelemetry: Telemetry = {
  deviceId: "lpc1768-01",
  loadPercent: 0,
  state: "normal",
  sequence: 0,
  timestamp: new Date().toISOString(),
  source: "simulator"
};

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

const clients = new Set<Response>();
let previousState: MachineState = "normal";
let lastCloudSend = 0;
let cloudBusy = false;
let iotClient: ReturnType<typeof Client.fromConnectionString> | null = null;

function log(message: string): void {
  const entry = `${new Date().toLocaleTimeString("en-GB", { hour12: false })}  ${message}`;
  dashboard.logs.unshift(entry);
  dashboard.logs = dashboard.logs.slice(0, 12);
  console.log(entry);
}

function broadcast(): void {
  const payload = `data: ${JSON.stringify(dashboard)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

function validateTelemetry(input: unknown, source: Telemetry["source"]): Telemetry {
  if (!input || typeof input !== "object") {
    throw new Error("Telemetry must be a JSON object");
  }

  const candidate = input as Record<string, unknown>;
  const loadPercent = Number(candidate.loadPercent);
  const sequence = Number(candidate.sequence);
  const state = candidate.state;
  const deviceId = candidate.deviceId;

  if (typeof deviceId !== "string" || deviceId.length < 1 || deviceId.length > 64) {
    throw new Error("Invalid deviceId");
  }
  if (!Number.isFinite(loadPercent) || loadPercent < 0 || loadPercent > 100) {
    throw new Error("loadPercent must be between 0 and 100");
  }
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error("sequence must be a non-negative integer");
  }
  if (state !== "normal" && state !== "warning" && state !== "critical") {
    throw new Error("Invalid machine state");
  }

  const deterministicState: MachineState =
    loadPercent >= 85 ? "critical" : loadPercent >= 70 ? "warning" : "normal";
  if (state !== deterministicState) {
    throw new Error(`State ${state} disagrees with deterministic threshold ${deterministicState}`);
  }

  return {
    deviceId,
    loadPercent: Math.round(loadPercent),
    state,
    sequence,
    timestamp: new Date().toISOString(),
    source
  };
}

function runValidationSelfCheck(): void {
  validateTelemetry(
    { deviceId: "self-test", loadPercent: 50, state: "normal", sequence: 0 },
    "simulator"
  );

  const invalidMessages = [
    { deviceId: "self-test", loadPercent: -1, state: "normal", sequence: 1 },
    { deviceId: "self-test", loadPercent: 88, state: "normal", sequence: 2 },
    { deviceId: "", loadPercent: 50, state: "normal", sequence: 3 },
    { deviceId: "self-test", loadPercent: 50, state: "unknown", sequence: 4 }
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
  message.contentType = "application/json";
  message.contentEncoding = "utf-8";
  message.properties.add("state", telemetry.state);
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

function normalizeExplanation(raw: string): IncidentExplanation {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<IncidentExplanation>;
  return {
    verifiedFacts: parsed.verifiedFacts ?? "No verified facts returned",
    possibleCause: String(parsed.possibleCause ?? "No hypothesis returned"),
    suggestedCheck: String(parsed.suggestedCheck ?? "No inspection guidance returned"),
    limitation: String(parsed.limitation ?? "No limitation returned")
  };
}

async function explainIncident(telemetry: Telemetry): Promise<IncidentExplanation> {
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
        messages: [
          {
            role: "system",
            content:
              "Return concise valid JSON with keys verifiedFacts, possibleCause, suggestedCheck, limitation. " +
              "Use supplied facts only, label hypotheses, never invent measurements, and never propose device control."
          },
          {
            role: "user",
            content:
              `Device ${telemetry.deviceId} reports simulated load ${telemetry.loadPercent} percent, ` +
              `deterministic state ${telemetry.state}, warning threshold 70 percent, critical threshold 85 percent.`
          }
        ],
        max_completion_tokens: 1000,
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

async function processTelemetry(telemetry: Telemetry): Promise<void> {
  dashboard.telemetry = telemetry;
  dashboard.history.push(telemetry);
  dashboard.history = dashboard.history.slice(-120);

  const stateChanged = telemetry.state !== previousState;
  let incident: Incident | undefined;
  if (stateChanged) {
    incident = {
      id: `${telemetry.sequence}-${Date.now()}`,
      timestamp: telemetry.timestamp,
      from: previousState,
      to: telemetry.state,
      loadPercent: telemetry.loadPercent
    };
    dashboard.incidents.unshift(incident);
    dashboard.incidents = dashboard.incidents.slice(0, 20);
    log(`State changed ${previousState.toUpperCase()} -> ${telemetry.state.toUpperCase()}`);
    previousState = telemetry.state;
  }

  broadcast();

  const cloudAllowed = telemetry.source === "board" || simulatorCloudEnabled;
  const cloudDue = Date.now() - lastCloudSend >= cloudIntervalMs;
  if (cloudAllowed && !cloudBusy && (cloudDue || stateChanged)) {
    cloudBusy = true;
    lastCloudSend = Date.now();
    try {
      await sendToIoTHub(telemetry);
    } catch (error) {
      dashboard.links.iotHub = "error";
      dashboard.cloud.lastError = error instanceof Error ? error.message : String(error);
      log(`IoT Hub error: ${dashboard.cloud.lastError}`);
    } finally {
      cloudBusy = false;
      broadcast();
    }
  }

  if (cloudAllowed && incident && telemetry.state !== "normal") {
    try {
      log(`Requesting Foundry explanation for ${telemetry.state} incident`);
      incident.explanation = await explainIncident(telemetry);
      log("Foundry explanation received");
    } catch (error) {
      dashboard.links.foundry = "error";
      log(`Foundry error: ${error instanceof Error ? error.message : String(error)}`);
    }
    broadcast();
  }
}

async function chooseSerialPort(): Promise<string | null> {
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
  const serialPath = await chooseSerialPort();
  if (!serialPath) {
    log("No compatible COM port detected");
    dashboard.links.board = "offline";
    return false;
  }

  const serial = new SerialPort({ path: serialPath, baudRate: serialBaud });
  const parser = serial.pipe(new ReadlineParser({ delimiter: "\n" }));

  serial.on("open", () => {
    dashboard.links.board = "ready";
    log(`Board connected on ${serialPath}`);
    broadcast();
  });
  serial.on("error", (error) => {
    dashboard.links.board = "error";
    log(`Serial error: ${error.message}`);
    broadcast();
  });
  serial.on("close", () => {
    dashboard.links.board = "offline";
    log("Board serial connection closed");
    broadcast();
  });
  parser.on("data", (line: string) => {
    try {
      const telemetry = validateTelemetry(JSON.parse(line.trim()), "board");
      void processTelemetry(telemetry);
    } catch (error) {
      log(`Rejected serial message: ${error instanceof Error ? error.message : String(error)}`);
      broadcast();
    }
  });
  return true;
}

function startSimulator(): void {
  dashboard.links.board = "ready";
  log("Simulator active because no board COM port is available");
  if (!simulatorCloudEnabled) {
    log("Simulator cloud traffic is disabled to protect the daily quota");
  }
  let sequence = 1;
  setInterval(() => {
    const cycle = sequence % 80;
    const base =
      cycle < 25 ? 35 + cycle : cycle < 45 ? 60 + (cycle - 25) * 1.5 : cycle < 60 ? 90 - (cycle - 45) : 50;
    const loadPercent = Math.max(0, Math.min(100, Math.round(base)));
    const state: MachineState =
      loadPercent >= 85 ? "critical" : loadPercent >= 70 ? "warning" : "normal";
    const telemetry = validateTelemetry(
      { deviceId: "lpc1768-01", loadPercent, state, sequence: sequence++ },
      "simulator"
    );
    void processTelemetry(telemetry);
  }, 1000);
}

const app = express();
app.disable("x-powered-by");
app.get("/api/status", (_request, response) => response.json(dashboard));
app.get("/api/health", (_request, response) =>
  response.json({ status: "ok", source: dashboard.telemetry.source, links: dashboard.links })
);
app.get("/events", (request, response) => {
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
app.use(express.static(webDirectory));
app.get("/{*path}", (_request, response) => response.sendFile(path.join(webDirectory, "index.html")));

async function main(): Promise<void> {
  runValidationSelfCheck();

  try {
    await openIoTHub();
  } catch (error) {
    dashboard.links.iotHub = "error";
    log(`IoT Hub startup error: ${error instanceof Error ? error.message : String(error)}`);
  }

  const serialStarted = await startSerial().catch((error) => {
    dashboard.links.board = "error";
    log(`Serial startup error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  });
  if (!serialStarted && simulatorEnabled) {
    startSimulator();
  }

  app.listen(port, () => log(`Dashboard available at http://localhost:${port}`));
}

void main();
