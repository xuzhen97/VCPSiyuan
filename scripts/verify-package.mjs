import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const packageZipPath = path.resolve(process.cwd(), "package.zip");
if (!fs.existsSync(packageZipPath)) {
    console.error("package.zip does not exist. Run build first.");
    process.exit(1);
}

const zip = new AdmZip(packageZipPath);
const entries = zip.getEntries().map((entry) => entry.entryName);

const requiredEntries = [
    "index.js",
    "index.css",
    "kernel.js",
    "plugin.json",
    "README.md",
    "README.zh-CN.md",
    "LICENSE",
    "i18n/en.json",
    "i18n/zh-CN.json",
];

for (const req of requiredEntries) {
    if (!entries.includes(req)) {
        console.error(`Missing required package entry: ${req}`);
        process.exit(1);
    }
}

const forbiddenPrefixes = ["src/", "tests/", "examples/", ".tmp/", "dist/"];
for (const entry of entries) {
    if (forbiddenPrefixes.some((prefix) => entry.startsWith(prefix))) {
        console.error(`Forbidden path prefix in package.zip: ${entry}`);
        process.exit(1);
    }
    if (entry.endsWith(".map")) {
        console.error(`Source maps are forbidden in package.zip: ${entry}`);
        process.exit(1);
    }
}

const manifestEntry = zip.getEntry("plugin.json");
if (!manifestEntry) {
    console.error("plugin.json missing in package.zip");
    process.exit(1);
}

const manifest = JSON.parse(manifestEntry.getData().toString("utf-8"));
if (manifest.name !== "VCPSiyuan") {
    console.error(`Expected plugin name 'VCPSiyuan', got '${manifest.name}'`);
    process.exit(1);
}

console.log("✓ package.zip verified successfully:", entries.length, "entries");
