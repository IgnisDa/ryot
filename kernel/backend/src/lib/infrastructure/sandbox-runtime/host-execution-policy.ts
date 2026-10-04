import type { SandboxHostCapability } from "@ryot-app/contract/modules/sandbox/wire";
import type { sandboxHostContracts } from "@ryot-app/sandbox-sdk/core";

import { isSandboxCapability } from "./capability-policy";
import type { SandboxExecutionPrincipal } from "./execution-principal";
import { SANDBOX_JSON_GRAPH_FACTOR } from "./json-bytes";
import { KiB, SANDBOX_LIMITS } from "./limits";

export const SANDBOX_HOST_EXECUTION_POLICY = {
	log: { resultBytes: KiB, dispatch: "diagnostic" },
	span: { resultBytes: KiB, dispatch: "diagnostic" },
	setCachedValue: { resultBytes: KiB, dispatch: "activity" },
	getPluginConfig: { resultBytes: null, dispatch: "activity" },
	getUserSettings: { resultBytes: null, dispatch: "activity" },
	getEntitySchemas: { resultBytes: null, dispatch: "activity" },
	listEventSchemas: { resultBytes: null, dispatch: "activity" },
	listIntegrations: { resultBytes: null, dispatch: "activity" },
	getUserPreferences: { resultBytes: KiB, dispatch: "activity" },
	createEvents: { resultBytes: null, dispatch: "event-workflow" },
	emitSignal: { resultBytes: null, dispatch: "service-workflow" },
	getOAuthAccessToken: { resultBytes: null, dispatch: "activity" },
	getCurrentIntegration: { resultBytes: null, dispatch: "activity" },
	requestEventStreamWork: { resultBytes: KiB, dispatch: "activity" },
	deleteEvents: { resultBytes: null, dispatch: "lifecycle-workflow" },
	updateEvents: { resultBytes: null, dispatch: "lifecycle-workflow" },
	invalidateOAuthAccessToken: { resultBytes: KiB, dispatch: "activity" },
	ensureUserEntities: { resultBytes: null, dispatch: "service-workflow" },
	sendNotification: { resultBytes: null, dispatch: "notification-workflow" },
	upsertGlobalEntities: { resultBytes: null, dispatch: "lifecycle-workflow" },
	changeUserRelationships: { resultBytes: null, dispatch: "lifecycle-workflow" },
	upsertGlobalRelationships: { resultBytes: null, dispatch: "lifecycle-workflow" },
	httpCall: { dispatch: "activity", resultBytes: 2 * SANDBOX_LIMITS.http.responseBytes },
	executeRyotql: {
		dispatch: "activity",
		resultBytes: SANDBOX_JSON_GRAPH_FACTOR * SANDBOX_LIMITS.ryotqlResultBytes,
	},
	getCachedValue: {
		dispatch: "activity",
		resultBytes: SANDBOX_JSON_GRAPH_FACTOR * SANDBOX_LIMITS.cache.valueBytes,
	},
	getPersistentValue: {
		dispatch: "activity",
		resultBytes: SANDBOX_JSON_GRAPH_FACTOR * (SANDBOX_LIMITS.cache.valueBytes + KiB),
	},
	claimPersistentValue: {
		dispatch: "activity",
		resultBytes: SANDBOX_JSON_GRAPH_FACTOR * (SANDBOX_LIMITS.cache.valueBytes + KiB),
	},
} as const satisfies Record<
	keyof typeof sandboxHostContracts,
	{ readonly dispatch: string; readonly resultBytes: number | null }
>;

export const sandboxDurableHostDispatchStrategy = (capability: SandboxHostCapability) => {
	if (capability === "artifact-read" || capability === "scratch") {
		return null;
	}
	return SANDBOX_HOST_EXECUTION_POLICY[capability].dispatch;
};

export const sandboxHostResultBytes = (capability: SandboxHostCapability) => {
	if (capability === "artifact-read" || capability === "scratch") {
		return null;
	}
	return SANDBOX_HOST_EXECUTION_POLICY[capability].resultBytes;
};

export const sandboxInlineDurableCapabilities = (principal: SandboxExecutionPrincipal) =>
	(principal.metadata.capabilities ?? []).filter(
		(capability): capability is SandboxHostCapability =>
			isSandboxCapability(capability) &&
			sandboxDurableHostDispatchStrategy(capability) === "activity" &&
			sandboxHostResultBytes(capability) !== null,
	);
