// Narrow plugin-sdk surface for the bundled diagnostics-oct8 plugin.
// Keep this list additive and scoped to symbols used under extensions/diagnostics-oct8.

export type { AgentEventPayload } from "../infra/agent-events.js";
export { onAgentEvent } from "../infra/agent-events.js";
export type { DiagnosticEventPayload } from "../infra/diagnostic-events.js";
export { onDiagnosticEvent } from "../infra/diagnostic-events.js";
export { resolveGatewayAuth } from "../gateway/auth.js";
export type { ResolvedGatewayAuth } from "../gateway/auth.js";
export type { OpenClawConfig } from "../config/config.js";
export type {
  OpenClawPluginApi,
  OpenClawPluginService,
  OpenClawPluginServiceContext,
} from "../plugins/types.js";
