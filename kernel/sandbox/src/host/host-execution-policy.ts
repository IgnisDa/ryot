import type { SandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import { isSandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import type { sandboxHostContracts } from "@ryot-app/plugin-backend-sdk/core";

import { KiB, MiB, SANDBOX_LIMITS } from "../protocol/limits";
import { SANDBOX_JSON_GRAPH_FACTOR } from "./json-bytes";
import type { SandboxPrincipal } from "./principal";

const integrationRecordBytes = SANDBOX_LIMITS.integrations.settingsBytes + 2 * KiB;

export const SANDBOX_HOST_EXECUTION_POLICY = {
	invokeCapability: { resultBytes: MiB, dispatch: "service" },
	getEntitlements: { resultBytes: KiB, dispatch: "activity" },
	getUserPreferences: { resultBytes: KiB, dispatch: "activity" },
	log: { permit: "small", resultBytes: KiB, dispatch: "diagnostic" },
	span: { permit: "small", resultBytes: KiB, dispatch: "diagnostic" },
	invalidateOAuthAccessToken: { resultBytes: KiB, dispatch: "activity" },
	setCachedValue: { permit: "small", resultBytes: KiB, dispatch: "activity" },
	verifyManagedAssets: { wireBytes: KiB, resultBytes: KiB, dispatch: "activity" },
	httpCall: { dispatch: "activity", resultBytes: 2 * SANDBOX_LIMITS.http.responseBytes },
	getCurrentIntegration: {
		dispatch: "activity",
		wireBytes: integrationRecordBytes + KiB,
		resultBytes: SANDBOX_JSON_GRAPH_FACTOR * integrationRecordBytes,
	},
	executeRyotql: {
		dispatch: "activity",
		wireBytes: SANDBOX_LIMITS.ryotqlResultBytes + KiB,
		resultBytes: SANDBOX_JSON_GRAPH_FACTOR * SANDBOX_LIMITS.ryotqlResultBytes,
	},
	getPluginConfig: {
		dispatch: "activity",
		wireBytes: SANDBOX_LIMITS.pluginConfigBytes + KiB,
		resultBytes: SANDBOX_JSON_GRAPH_FACTOR * SANDBOX_LIMITS.pluginConfigBytes,
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
	getOAuthAccessToken: {
		dispatch: "activity",
		wireBytes: SANDBOX_LIMITS.oauthTokenResponseBytes + KiB,
		resultBytes: SANDBOX_JSON_GRAPH_FACTOR * SANDBOX_LIMITS.oauthTokenResponseBytes,
	},
	getCachedValue: {
		permit: "small",
		dispatch: "activity",
		wireBytes: SANDBOX_LIMITS.cache.valueBytes + KiB,
		resultBytes: SANDBOX_JSON_GRAPH_FACTOR * SANDBOX_LIMITS.cache.valueBytes,
	},
	listIntegrations: {
		dispatch: "activity",
		wireBytes: SANDBOX_LIMITS.integrations.pageSize * integrationRecordBytes + 2 * KiB,
		resultBytes:
			SANDBOX_JSON_GRAPH_FACTOR *
			(SANDBOX_LIMITS.integrations.pageSize * integrationRecordBytes + KiB),
	},
} as const satisfies Record<
	keyof typeof sandboxHostContracts,
	{
		readonly dispatch: string;
		readonly permit?: "small";
		readonly wireBytes?: number;
		readonly resultBytes: number;
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
			inlineDispatches.has(sandboxDurableHostDispatchStrategy(capability)),
	);
