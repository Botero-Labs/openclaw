import { ACTIONS_BY_SERVICE, DESTRUCTIVE_ACTIONS_BY_SERVICE } from "./constants.js";
import type { PluginConfig, PolicyDecision, ServiceEntry, ServiceKind } from "./types.js";

type CheckPolicyParams = {
  config: PluginConfig;
  serviceKind: ServiceKind;
  email: string;
  agentId: string | undefined;
  action: string;
};

/**
 * Four-gate authorization check.
 *
 * Gate 1 — Service exists: is there a configured entry for (email, serviceKind)?
 * Gate 2 — Agent authorized: is agentId in allowedAgents (if specified)?
 * Gate 3 — Mode gate: is the action blocked by delegated_human mode?
 * Gate 4 — Action allowlist: is the action in allowedActions (if specified)?
 */
export function checkPolicy(params: CheckPolicyParams): PolicyDecision {
  const { config, serviceKind, email, agentId, action } = params;
  const normalizedEmail = email.trim().toLowerCase();

  // Gate 1 — Find matching service entry. If multiple entries exist for the
  // same (email, serviceKind), try to find one where the agent is authorized.
  let matchedEntry: ServiceEntry | undefined;
  let matchedId: string | undefined;

  for (const [id, entry] of Object.entries(config.services)) {
    if (entry.service !== serviceKind || entry.email !== normalizedEmail) continue;

    // If this entry has an agent allowlist, check if the agent is in it
    if (isAgentAllowed(entry, agentId)) {
      matchedEntry = entry;
      matchedId = id;
      break;
    }

    // Track the first match even if agent is not allowed, for the error message
    if (!matchedEntry) {
      matchedEntry = entry;
      matchedId = id;
    }
  }

  if (!matchedEntry || !matchedId) {
    return {
      allowed: false,
      code: "service_not_found",
      reason: `No ${serviceKind} service configured for ${normalizedEmail}.`,
    };
  }

  // Gate 2 — Agent authorized
  if (!isAgentAllowed(matchedEntry, agentId)) {
    return {
      allowed: false,
      code: "agent_not_authorized",
      reason: `Agent "${agentId ?? "(none)"}" is not authorized for service "${matchedId}".`,
    };
  }

  // Gate 3 — Mode gate: block destructive actions in delegated_human mode
  const destructive = DESTRUCTIVE_ACTIONS_BY_SERVICE[serviceKind];
  if (matchedEntry.mode === "delegated_human" && destructive.includes(action)) {
    return {
      allowed: false,
      code: "mode_blocked",
      reason: `Action "${action}" is blocked in delegated_human mode for ${serviceKind}.`,
    };
  }

  // Gate 4 — Action allowlist
  if (matchedEntry.allowedActions !== undefined) {
    if (!matchedEntry.allowedActions.includes(action)) {
      return {
        allowed: false,
        code: "action_not_allowed",
        reason: `Action "${action}" is not in the allowedActions list for service "${matchedId}".`,
      };
    }
  } else {
    // When no allowlist is specified, check that the action is a valid action for this service
    const validActions = ACTIONS_BY_SERVICE[serviceKind];
    if (!validActions.includes(action)) {
      return {
        allowed: false,
        code: "action_not_allowed",
        reason: `Action "${action}" is not a valid action for service "${serviceKind}".`,
      };
    }
  }

  return { allowed: true, entry: matchedEntry, serviceId: matchedId };
}

/**
 * List all actions that a given agent is allowed to perform on a service.
 * Returns the intersection of mode-permitted and allowlist-permitted actions.
 */
export function listAllowedActions(params: {
  config: PluginConfig;
  serviceKind: ServiceKind;
  email: string;
  agentId: string | undefined;
}): string[] {
  const { config, serviceKind, email, agentId } = params;
  const normalizedEmail = email.trim().toLowerCase();

  // Find the first entry where agent is authorized
  let entry: ServiceEntry | undefined;
  for (const e of Object.values(config.services)) {
    if (e.service !== serviceKind || e.email !== normalizedEmail) continue;
    if (isAgentAllowed(e, agentId)) {
      entry = e;
      break;
    }
  }

  if (!entry) return [];

  const allActions = ACTIONS_BY_SERVICE[serviceKind];
  const destructive = DESTRUCTIVE_ACTIONS_BY_SERVICE[serviceKind];

  return allActions.filter((action) => {
    // Mode gate
    if (entry.mode === "delegated_human" && destructive.includes(action)) return false;
    // Allowlist gate
    if (entry.allowedActions !== undefined && !entry.allowedActions.includes(action)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAgentAllowed(entry: ServiceEntry, agentId: string | undefined): boolean {
  // If no allowlist is specified or it's empty, all agents are allowed
  if (!entry.allowedAgents || entry.allowedAgents.length === 0) return true;
  // If an allowlist exists, agentId must be present and match (case-sensitive)
  if (agentId === undefined) return false;
  return entry.allowedAgents.includes(agentId);
}
