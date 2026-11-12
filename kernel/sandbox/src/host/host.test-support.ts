import { Effect, Layer, Option } from "effect";

import { bindSandboxHostFunctions } from "./bridge-adapter";
import { SandboxHostCallScope, SandboxHostConfig } from "./config";
import type { SandboxHostFunctions } from "./host-functions";
import type { SandboxHostImplementationMap } from "./invocation";

export const makeSandboxHostConfigLayer = (overrides: Partial<SandboxHostConfig["Service"]> = {}) =>
	Layer.mergeAll(
		Layer.succeed(SandboxHostConfig, {
			runId: "test-run",
			workerConcurrency: 2,
			perUserSidecars: false,
			tempDirectory: "./work",
			memoryBudgetMiB: Option.none(),
			...overrides,
		}),
		Layer.succeed(SandboxHostCallScope, { bound: (effect) => effect }),
	);

export const testExecutionId = (label: string) => `${label}-${crypto.randomUUID()}`;

const unusedHostCall = () => Effect.die("Unexpected sandbox host dispatch");

type SandboxHostFunctionMap = Omit<SandboxHostImplementationMap, "log" | "span">;

const unusedSandboxHostFunctionMap = (
	overrides: Partial<SandboxHostFunctionMap>,
): SandboxHostFunctionMap => ({
	httpCall: unusedHostCall,
	emitSignal: unusedHostCall,
	createEvents: unusedHostCall,
	deleteEvents: unusedHostCall,
	updateEvents: unusedHostCall,
	requestFolds: unusedHostCall,
	executeRyotql: unusedHostCall,
	getCachedValue: unusedHostCall,
	setCachedValue: unusedHostCall,
	invokeOperation: unusedHostCall,
	getPluginConfig: unusedHostCall,
	getUserSettings: unusedHostCall,
	createUserEntity: unusedHostCall,
	deleteUserEntity: unusedHostCall,
	updateUserEntity: unusedHostCall,
	getEntitySchemas: unusedHostCall,
	listEventSchemas: unusedHostCall,
	listIntegrations: unusedHostCall,
	sendNotification: unusedHostCall,
	commitUserChanges: unusedHostCall,
	updateUserSettings: unusedHostCall,
	ensureUserEntities: unusedHostCall,
	getPersistentValue: unusedHostCall,
	getUserPreferences: unusedHostCall,
	getProAvailability: unusedHostCall,
	mergeUserEntityData: unusedHostCall,
	clearUserEntityData: unusedHostCall,
	verifyManagedAssets: unusedHostCall,
	getOAuthAccessToken: unusedHostCall,
	claimPersistentValue: unusedHostCall,
	upsertGlobalEntities: unusedHostCall,
	getCurrentIntegration: unusedHostCall,
	requestFoldsForAllUsers: unusedHostCall,
	changeUserRelationships: unusedHostCall,
	upsertGlobalRelationships: unusedHostCall,
	invalidateOAuthAccessToken: unusedHostCall,
	...overrides,
});

export const unusedSandboxHostFunctions = (
	overrides: Partial<SandboxHostFunctionMap> = {},
): SandboxHostFunctions["Service"] => {
	const implementations = unusedSandboxHostFunctionMap(overrides);
	return { bind: (input) => Effect.succeed(bindSandboxHostFunctions(implementations, input)) };
};
