import { existsSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";

const projectRoot = process.cwd();
const distDir = resolve(projectRoot, "dist");

if (basename(distDir) !== "dist" || !distDir.startsWith(projectRoot)) {
  throw new Error(`Refusing to clean unexpected output directory: ${distDir}`);
}

if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}

console.log("Cleaned generated dist output.");
