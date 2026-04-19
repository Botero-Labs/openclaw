import os from "node:os";
import path from "node:path";
import { definePluginEntry } from "./api.js";
import { registerCalendarTools } from "./src/calendar/tools.js";
import { parsePluginConfig } from "./src/config.js";
import { registerContactsTools } from "./src/contacts/tools.js";
import { registerDocsTools } from "./src/docs/tools.js";
import { registerDriveTools } from "./src/drive/tools.js";
import { registerGmailTools } from "./src/gmail/tools.js";
import { registerGmailWatchService } from "./src/gmail/watch.js";
import { registerSheetsTools } from "./src/sheets/tools.js";

function resolveStateDir(): string {
  return path.join(os.homedir(), ".openclaw");
}

export default definePluginEntry({
  id: "oct8-google-workspace",
  name: "oct8 Google Workspace",
  description: "Google Workspace tools for oct8 digital coworkers",
  register(api) {
    const { config, issues } = parsePluginConfig(api.pluginConfig);
    for (const issue of issues) {
      api.logger.warn(`[oct8-gws] ${issue}`);
    }
    if (!config) {
      return;
    }

    const stateDir = resolveStateDir();
    registerGmailTools(api, config, stateDir);
    registerCalendarTools(api, config, stateDir);
    registerDriveTools(api, config, stateDir);
    registerContactsTools(api, config, stateDir);
    registerSheetsTools(api, config, stateDir);
    registerDocsTools(api, config, stateDir);
    registerGmailWatchService(api, config, stateDir);

    const serviceCount = Object.keys(config.services).length;
    if (serviceCount > 0) {
      api.logger.info(`[oct8-gws] loaded with ${serviceCount} service(s)`);
    }
  },
});
