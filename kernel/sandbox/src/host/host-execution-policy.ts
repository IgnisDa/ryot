import type { SandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import { isSandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import type { sandboxHostContracts } from "@ryot-app/plugin-backend-sdk/core";

import { KiB, MiB, SANDBOX_LIMITS } from "../protocol/limits";
import { SANDBOX_JSON_GRAPH_FACTOR } from "./json-bytes";
import type { SandboxPrincipal } from "./principal";

export const SANDBOX_HOST_EXECUTION_POLICY = {
	getPluginConfig: { resultBytes: null, dispatch: "activity" },
	getUserSettings: { resultBytes: null, dispatch: "activity" },
	getEntitySchemas: { resultBytes: null, dispatch: "activity" },
	listEventSchemas: { resultBytes: null, dispatch: "activity" },
	listIntegrations: { resultBytes: null, dispatch: "activity" },
	updateUserSettings: { resultBytes: KiB, dispatch: "activity" },
	getUserPreferences: { resultBytes: KiB, dispatch: "activity" },
	getProAvailability: { resultBytes: KiB, dispatch: "activity" },
	createEvents: { resultBytes: MiB, dispatch: "event-workflow" },
	emitSignal: { resultBytes: MiB, dispatch: "service-workflow" },
	getOAuthAccessToken: { resultBytes: null, dispatch: "activity" },
	log: { permit: "small", resultBytes: KiB, dispatch: "diagnostic" },
	getCurrentIntegration: { resultBytes: null, dispatch: "activity" },
	deleteEvents: { resultBytes: MiB, dispatch: "lifecycle-workflow" },
	updateEvents: { resultBytes: MiB, dispatch: "lifecycle-workflow" },
	requestUserWork: { resultBytes: KiB, dispatch: "service-workflow" },
	span: { permit: "small", resultBytes: KiB, dispatch: "diagnostic" },
	createUserEntity: { resultBytes: MiB, dispatch: "service-workflow" },
	deleteUserEntity: { resultBytes: MiB, dispatch: "service-workflow" },
	updateUserEntity: { resultBytes: MiB, dispatch: "service-workflow" },
	commitUserChanges: { resultBytes: MiB, dispatch: "service-workflow" },
	invalidateOAuthAccessToken: { resultBytes: KiB, dispatch: "activity" },
	ensureUserEntities: { resultBytes: MiB, dispatch: "service-workflow" },
	mergeUserEntityData: { resultBytes: MiB, dispatch: "service-workflow" },
	clearUserEntityData: { resultBytes: MiB, dispatch: "service-workflow" },
	sendNotification: { resultBytes: MiB, dispatch: "notification-workflow" },
	requestEventStreamWork: { resultBytes: KiB, dispatch: "service-workflow" },
	upsertGlobalEntities: { resultBytes: MiB, dispatch: "lifecycle-workflow" },
	setCachedValue: { permit: "small", resultBytes: KiB, dispatch: "activity" },
	changeUserRelationships: { resultBytes: MiB, dispatch: "lifecycle-workflow" },
	verifyManagedAssets: { wireBytes: KiB, resultBytes: KiB, dispatch: "activity" },
	upsertGlobalRelationships: { resultBytes: MiB, dispatch: "lifecycle-workflow" },
	requestRelationshipProjections: { resultBytes: KiB, dispatch: "service-workflow" },
	httpCall: { dispatch: "activity", resultBytes: 2 * SANDBOX_LIMITS.http.responseBytes },
	requestRelationshipProjectionsForAllUsers: { resultBytes: KiB, dispatch: "service-workflow" },
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
		readonly wireBytes?: number;
		readonly resultBytes: null | number;
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

const inlineDispatches = new Set<null | string>([
	"activity",
	"event-workflow",
	"service-workflow",
	"lifecycle-workflow",
	"notification-workflow",
]);

export const sandboxInlineDurableCapabilities = (principal: SandboxPrincipal) =>
	(principal.metadata.capabilities ?? []).filter(
		(capability): capability is SandboxHostCapability =>
			isSandboxHostCapability(capability) &&
			inlineDispatches.has(sandboxDurableHostDispatchStrategy(capability)) &&
			sandboxHostResultBytes(capability) !== null,
	);
