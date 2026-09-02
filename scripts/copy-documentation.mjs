import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const source = resolve("documentation");
const destination = resolve("dist", "documentation");

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(source, destination, { recursive: true });

console.log("Copied documentation into the deployment artifact.");
