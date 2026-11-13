import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
mkdirSync(output, { recursive: true });
copyFileSync(resolve(root, "env.json"), resolve(output, "env.json"));
