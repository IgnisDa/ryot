import type { SandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import { isSandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import type { sandboxHostContracts } from "@ryot-app/plugin-backend-sdk/core";

import { KiB, MiB, SANDBOX_LIMITS } from "../protocol/limits";
import { SANDBOX_JSON_GRAPH_FACTOR } from "./json-bytes";
import type { SandboxPrincipal } from "./principal";

export const SANDBOX_HOST_EXECUTION_POLICY = {
	invokeCapability: { resultBytes: MiB, dispatch: "service" },
	getEntitlements: { resultBytes: KiB, dispatch: "activity" },
	getPluginConfig: { resultBytes: null, dispatch: "activity" },
	getEntitySchemas: { resultBytes: null, dispatch: "activity" },
	listEventSchemas: { resultBytes: null, dispatch: "activity" },
	listIntegrations: { resultBytes: null, dispatch: "activity" },
	getUserPreferences: { resultBytes: KiB, dispatch: "activity" },
	getOAuthAccessToken: { resultBytes: null, dispatch: "activity" },
	log: { permit: "small", resultBytes: KiB, dispatch: "diagnostic" },
	getCurrentIntegration: { resultBytes: null, dispatch: "activity" },
	span: { permit: "small", resultBytes: KiB, dispatch: "diagnostic" },
	invalidateOAuthAccessToken: { resultBytes: KiB, dispatch: "activity" },
	setCachedValue: { permit: "small", resultBytes: KiB, dispatch: "activity" },
	verifyManagedAssets: { wireBytes: KiB, resultBytes: KiB, dispatch: "activity" },
	httpCall: { dispatch: "activity", resultBytes: 2 * SANDBOX_LIMITS.http.responseBytes },
	executeRyotql: {
		dispatch: "activity",
		wireBytes: SANDBOX_LIMITS.ryotqlResultBytes + KiB,
		resultBytes: SANDBOX_JSON_GRAPH_FACTOR * SANDBOX_LIMITS.ryotqlResultBytes,
	},
	getUserSettings: {
		dispatch: "activity",
		wireBytes: SANDBOX_LIMITS.userSettingsBytes + KiB,
		resultBytes: SANDBOX_JSON_GRAPH_FACTOR * SANDBOX_LIMITS.userSettingsBytes,
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

const inlineDispatches = new Set<null | string>(["service", "activity"]);

export const sandboxInlineDurableCapabilities = (principal: SandboxPrincipal) =>
	(principal.metadata.capabilities ?? []).filter(
		(capability): capability is SandboxHostCapability =>
			isSandboxHostCapability(capability) &&
			inlineDispatches.has(sandboxDurableHostDispatchStrategy(capability)) &&
			sandboxHostResultBytes(capability) !== null,
	);
