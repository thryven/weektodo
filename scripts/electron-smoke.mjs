import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { extractFile, listPackage } from "@electron/asar";

const archive = path.resolve("dist_electron", "win-unpacked", "resources", "app.asar");
assert.ok(existsSync(archive), `Packaged Electron archive not found: ${archive}`);

const files = listPackage(archive, { isPack: false }).map((entry) => entry.replaceAll("\\", "/"));
const requiredFiles = ["/package.json", "/dist/index.html", "/dist-electron/main.js", "/dist-electron/preload.js"];

for (const file of requiredFiles) {
  assert.ok(files.includes(file), `Packaged Electron archive is missing ${file}`);
}

assert.ok(!files.some((file) => file.startsWith("/node_modules/")), "Production archive unexpectedly contains node_modules");
assert.ok(!files.includes("/dist/sw.js"), "Electron renderer unexpectedly contains a service worker");

const metadata = JSON.parse(extractFile(archive, "package.json").toString("utf8"));
assert.equal(metadata.main, "dist-electron/main.js");

console.log(`Electron package smoke check passed (${files.length} archive entries).`);
