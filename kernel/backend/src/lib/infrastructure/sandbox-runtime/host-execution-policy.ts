import type { SandboxHostCapability } from "@ryot-app/contract/modules/sandbox/wire";
import type { sandboxHostContracts } from "@ryot-app/sandbox-sdk/core";

import { isSandboxCapability } from "./capability-policy";
import type { SandboxExecutionPrincipal } from "./execution-principal";
import { SANDBOX_JSON_GRAPH_FACTOR } from "./json-bytes";
import { KiB, SANDBOX_LIMITS } from "./limits";

export const SANDBOX_HOST_EXECUTION_POLICY = {
	getPluginConfig: { resultBytes: null, dispatch: "activity" },
	getUserSettings: { resultBytes: null, dispatch: "activity" },
	getEntitySchemas: { resultBytes: null, dispatch: "activity" },
	listEventSchemas: { resultBytes: null, dispatch: "activity" },
	listIntegrations: { resultBytes: null, dispatch: "activity" },
	getUserPreferences: { resultBytes: KiB, dispatch: "activity" },
	createEvents: { resultBytes: null, dispatch: "event-workflow" },
	emitSignal: { resultBytes: null, dispatch: "service-workflow" },
	getOAuthAccessToken: { resultBytes: null, dispatch: "activity" },
	log: { permit: "small", resultBytes: KiB, dispatch: "diagnostic" },
	getCurrentIntegration: { resultBytes: null, dispatch: "activity" },
	requestEventStreamWork: { resultBytes: KiB, dispatch: "activity" },
	span: { permit: "small", resultBytes: KiB, dispatch: "diagnostic" },
	deleteEvents: { resultBytes: null, dispatch: "lifecycle-workflow" },
	updateEvents: { resultBytes: null, dispatch: "lifecycle-workflow" },
	invalidateOAuthAccessToken: { resultBytes: KiB, dispatch: "activity" },
	ensureUserEntities: { resultBytes: null, dispatch: "service-workflow" },
	sendNotification: { resultBytes: null, dispatch: "notification-workflow" },
	setCachedValue: { permit: "small", resultBytes: KiB, dispatch: "activity" },
	upsertGlobalEntities: { resultBytes: null, dispatch: "lifecycle-workflow" },
	changeUserRelationships: { resultBytes: null, dispatch: "lifecycle-workflow" },
	upsertGlobalRelationships: { resultBytes: null, dispatch: "lifecycle-workflow" },
	httpCall: { dispatch: "activity", resultBytes: 2 * SANDBOX_LIMITS.http.responseBytes },
	executeRyotql: {
		dispatch: "activity",
		wireBytes: SANDBOX_LIMITS.ryotqlResultBytes + KiB,
		resultBytes: SANDBOX_JSON_GRAPH_FACTOR * SANDBOX_LIMITS.ryotqlResultBytes,
	},
	getPersistentValue: {
		dispatch: "activity",
		wireBytes: SANDBOX_LIMITS.cache.valueBytes + 2 * KiB,
		resultBytes: SANDBOX_JSON_GRAPH_FACTOR * (SANDBOX_LIMITS.cache.valueBytes + KiB),
	},
	claimPersistentValue: {
		dispatch: "activity",
		wireBytes: SANDBOX_LIMITS.cache.valueBytes + 2 * KiB,
		resultBytes: SANDBOX_JSON_GRAPH_FACTOR * (SANDBOX_LIMITS.cache.valueBytes + KiB),
	},
	getCachedValue: {
		permit: "small",
		dispatch: "activity",
		wireBytes: SANDBOX_LIMITS.cache.valueBytes + KiB,
		resultBytes: SANDBOX_JSON_GRAPH_FACTOR * SANDBOX_LIMITS.cache.valueBytes,
	},
} as const satisfies Record<
	keyof typeof sandboxHostContracts,
	{
		readonly dispatch: string;
		readonly permit?: "small";
		readonly resultBytes: number | null;
		readonly wireBytes?: number;
	}
>;

const policyFor = (capability: SandboxHostCapability) =>
	capability === "artifact-read" || capability === "scratch"
		? null
		: SANDBOX_HOST_EXECUTION_POLICY[capability];

export const sandboxDurableHostDispatchStrategy = (capability: SandboxHostCapability) =>
	policyFor(capability)?.dispatch ?? null;

export const sandboxHostResultBytes = (capability: SandboxHostCapability) =>
	policyFor(capability)?.resultBytes ?? null;

export const sandboxHostResultWireBytes = (capability: SandboxHostCapability) => {
	if (capability === "artifact-read" || capability === "scratch") {
		return null;
	}
	const policy = SANDBOX_HOST_EXECUTION_POLICY[capability];
	return "wireBytes" in policy ? policy.wireBytes : policy.resultBytes;
};

export const sandboxHostPermit = (capability: SandboxHostCapability) => {
	const policy = policyFor(capability);
	return policy !== null && "permit" in policy ? policy.permit : "ordinary";
};

export const sandboxInlineDurableCapabilities = (principal: SandboxExecutionPrincipal) =>
	(principal.metadata.capabilities ?? []).filter(
		(capability): capability is SandboxHostCapability =>
			isSandboxCapability(capability) &&
			sandboxDurableHostDispatchStrategy(capability) === "activity" &&
			sandboxHostResultBytes(capability) !== null,
	);
