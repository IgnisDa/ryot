import { Effect } from "effect";

import type { SandboxLifecycleHostSteps } from "#lib/infrastructure/sandbox-runtime/host-functions";
import type { SandboxHostImplementationMaps } from "#lib/infrastructure/sandbox-runtime/host-implementations";
import type { RuntimeSandboxHostImplementationMap } from "#lib/infrastructure/sandbox-runtime/runtime-host-functions";

const unusedHostCall = () => Effect.die("Unexpected sandbox host dispatch");
const unusedLifecycleValue = (): never => {
	throw new Error("Unexpected sandbox lifecycle value");
};
const unusedLifecycleSteps = {
	commit: unusedHostCall,
	prepare: unusedHostCall,
	validate: unusedHostCall,
	value: unusedLifecycleValue,
	applyPolicies: unusedHostCall,
};
const unusedRelationshipSteps = {
	validate: unusedHostCall,
	value: unusedLifecycleValue,
	itemWrite: unusedLifecycleValue,
};

export const unusedSandboxHostImplementations = (
	runtime: Partial<RuntimeSandboxHostImplementationMap> = {},
	lifecycle: Partial<SandboxLifecycleHostSteps> = {},
): SandboxHostImplementationMaps => ({
	automation: { emitSignal: unusedHostCall, sendNotification: unusedHostCall },
	runtime: {
		httpCall: unusedHostCall,
		setCachedValue: unusedHostCall,
		getCachedValue: unusedHostCall,
		getPersistentValue: unusedHostCall,
		claimPersistentValue: unusedHostCall,
		...runtime,
	},
	lifecycle: {
		upsertGlobalEntities: unusedLifecycleSteps,
		changeUserRelationships: unusedRelationshipSteps,
		upsertGlobalRelationships: unusedRelationshipSteps,
		updateEvents: { commit: unusedHostCall, validate: unusedHostCall },
		deleteEvents: { commit: unusedHostCall, validate: unusedHostCall },
		...lifecycle,
	},
	additional: {
		deleteEvents: unusedHostCall,
		createEvents: unusedHostCall,
		updateEvents: unusedHostCall,
		executeRyotql: unusedHostCall,
		getPluginConfig: unusedHostCall,
		getUserSettings: unusedHostCall,
		listIntegrations: unusedHostCall,
		listEventSchemas: unusedHostCall,
		getEntitySchemas: unusedHostCall,
		createUserEntity: unusedHostCall,
		getUserPreferences: unusedHostCall,
		ensureUserEntities: unusedHostCall,
		getOAuthAccessToken: unusedHostCall,
		upsertGlobalEntities: unusedHostCall,
		getCurrentIntegration: unusedHostCall,
		requestEventStreamWork: unusedHostCall,
		changeUserRelationships: unusedHostCall,
		upsertGlobalRelationships: unusedHostCall,
		invalidateOAuthAccessToken: unusedHostCall,
	},
});
