import type { SandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import { isSandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import type { sandboxHostContracts } from "@ryot-app/plugin-backend-sdk/core";

import { KiB, SANDBOX_LIMITS } from "../protocol/limits";
import { SANDBOX_JSON_GRAPH_FACTOR } from "./json-bytes";
import type { SandboxPrincipal } from "./principal";

export const SANDBOX_HOST_EXECUTION_POLICY = {
	getPluginConfig: { resultBytes: null, dispatch: "activity" },
	getUserSettings: { resultBytes: null, dispatch: "activity" },
	getEntitySchemas: { resultBytes: null, dispatch: "activity" },
	listEventSchemas: { resultBytes: null, dispatch: "activity" },
	listIntegrations: { resultBytes: null, dispatch: "activity" },
	getUserPreferences: { resultBytes: KiB, dispatch: "activity" },
	getProAvailability: { resultBytes: KiB, dispatch: "activity" },
	createEvents: { resultBytes: null, dispatch: "event-workflow" },
	emitSignal: { resultBytes: null, dispatch: "service-workflow" },
	getOAuthAccessToken: { resultBytes: null, dispatch: "activity" },
	log: { permit: "small", resultBytes: KiB, dispatch: "diagnostic" },
	getCurrentIntegration: { resultBytes: null, dispatch: "activity" },
	requestEventStreamWork: { resultBytes: KiB, dispatch: "activity" },
	span: { permit: "small", resultBytes: KiB, dispatch: "diagnostic" },
	deleteEvents: { resultBytes: null, dispatch: "lifecycle-workflow" },
	updateEvents: { resultBytes: null, dispatch: "lifecycle-workflow" },
	createUserEntity: { resultBytes: null, dispatch: "service-workflow" },
	deleteUserEntity: { resultBytes: null, dispatch: "service-workflow" },
	updateUserEntity: { resultBytes: null, dispatch: "service-workflow" },
	commitUserChanges: { resultBytes: null, dispatch: "service-workflow" },
	invalidateOAuthAccessToken: { resultBytes: KiB, dispatch: "activity" },
	ensureUserEntities: { resultBytes: null, dispatch: "service-workflow" },
	mergeUserEntityData: { resultBytes: null, dispatch: "service-workflow" },
	sendNotification: { resultBytes: null, dispatch: "notification-workflow" },
	setCachedValue: { permit: "small", resultBytes: KiB, dispatch: "activity" },
	upsertGlobalEntities: { resultBytes: null, dispatch: "lifecycle-workflow" },
	changeUserRelationships: { resultBytes: null, dispatch: "lifecycle-workflow" },
	verifyManagedAssets: { wireBytes: KiB, resultBytes: KiB, dispatch: "activity" },
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

export const sandboxInlineDurableCapabilities = (principal: SandboxPrincipal) =>
	(principal.metadata.capabilities ?? []).filter(
		(capability): capability is SandboxHostCapability =>
			isSandboxHostCapability(capability) &&
			sandboxDurableHostDispatchStrategy(capability) === "activity" &&
			sandboxHostResultBytes(capability) !== null,
	);
