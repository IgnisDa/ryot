import { Effect } from "effect";

import type { RuntimeSandboxHostImplementationMap } from "#modules/scripts/host/runtime-host-functions";

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
