import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const schemaPath = path.join(rootDir, "extension", "src", "parser-configs", "schema.json");
const configsPath = path.join(rootDir, "extension", "src", "parser-configs", "index.json");

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${path.relative(rootDir, filePath)} is not valid JSON: ${error.message}`);
  }
}

const schema = readJson(schemaPath);
const configs = readJson(configsPath);
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate = ajv.compile(schema);

if (!validate(configs)) {
  console.error("Parser config validation failed:");
  for (const error of validate.errors || []) {
    const location = error.instancePath || "/";
    console.error(`- ${location}: ${error.message}`);
  }
  process.exit(1);
}

console.log(`Parser config validation passed: ${configs.length} configs`);
