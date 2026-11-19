import { Effect, Layer } from "effect";

import type { RuntimeSandboxHostImplementationMap } from "#modules/scripts/host/runtime-host-functions";
import { DatabaseSession } from "#platform/db/session";

import type { ScriptHostImplementationMaps } from "./host-implementations";

const unusedHostCall = () => Effect.die("Unexpected sandbox host dispatch");

export const unusedSandboxHostImplementations = (
	runtime: Partial<RuntimeSandboxHostImplementationMap> = {},
): ScriptHostImplementationMaps => ({
	runtime: {
		httpCall: unusedHostCall,
		setCachedValue: unusedHostCall,
		getCachedValue: unusedHostCall,
		getPersistentValue: unusedHostCall,
		claimPersistentValue: unusedHostCall,
		...runtime,
	},
	additional: {
		executeRyotql: unusedHostCall,
		getPluginConfig: unusedHostCall,
		getUserSettings: unusedHostCall,
		getEntitlements: unusedHostCall,
		invokeCapability: unusedHostCall,
		listIntegrations: unusedHostCall,
		getUserPreferences: unusedHostCall,
		verifyManagedAssets: unusedHostCall,
		getOAuthAccessToken: unusedHostCall,
		getCurrentIntegration: unusedHostCall,
		invalidateOAuthAccessToken: unusedHostCall,
	},
});

/** A session whose host calls run without a caller transaction, for sandboxes with no database. */
export const detachedHostCallSession = Layer.mock(DatabaseSession)({
	carry: Effect.succeed(<A, E, R>(work: Effect.Effect<A, E, R>) => work),
});
