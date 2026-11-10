import { readGlobalConfig, writeConfigJson } from "./heartfile.js";
import { parseEnvFile, DEFAULT_TEST_TIMEOUT, DEFAULT_TEST_LANES } from "./config.js";

// The settings as the lines of a .env, from config.json (HeartCode's format,
// see heartfile.js) or from an older .env, with `__order`: your models in the
// order they are asked in.
export function readStoredConfig() {
  return readGlobalConfig(parseEnvFile);
}

const joinModels = (models) => (Array.isArray(models) ? models.join(", ") : models || "");

// providers: [{ name, baseUrl, apiKey, models }, ...]. `order` is your models
// in the order they are asked in; what is not in it goes at the end, and what
// is no longer a provider's model is dropped from it. Written to config.json.
export function writeStoredConfig(config) {
  writeConfigJson(config, { testTimeout: DEFAULT_TEST_TIMEOUT, testLanes: DEFAULT_TEST_LANES });
}
