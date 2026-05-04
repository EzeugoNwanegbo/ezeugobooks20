import { existsSync, rmSync } from "node:fs";
import { basename, resolve } from "node:path";

const projectRoot = process.cwd();
const outputDirs = [resolve(projectRoot, "dist"), resolve(projectRoot, "dist-static")];

for (const outputDir of outputDirs) {
  if (!["dist", "dist-static"].includes(basename(outputDir)) || !outputDir.startsWith(projectRoot)) {
    throw new Error(`Refusing to clean unexpected output directory: ${outputDir}`);
  }

  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

console.log("Cleaned generated dist output.");
