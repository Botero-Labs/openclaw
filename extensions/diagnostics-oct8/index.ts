import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createDiagnosticsOct8Service } from "./src/service.js";

export default definePluginEntry({
  id: "diagnostics-oct8",
  name: "Diagnostics oct8",
  description: "Publish semantic coworker observability events to oct8",
  register(api) {
    api.registerService(createDiagnosticsOct8Service());
  },
});
