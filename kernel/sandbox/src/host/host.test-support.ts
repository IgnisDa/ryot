import { Effect, Layer, Option } from "effect";
import Redis from "ioredis";
import { inject } from "vitest";

import { bindSandboxHostFunctions } from "./bridge-adapter";
import { SandboxHostCallScope, SandboxHostConfig } from "./config";
import type { SandboxHostFunctions } from "./host-functions";
import type { SandboxHostImplementationMap } from "./invocation";
import { SandboxRedis } from "./redis";

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

export const testRedisUrl = () => inject("redisUrl");

export const testExecutionId = (label: string) => `${label}-${crypto.randomUUID()}`;

export const testSandboxRedisLayer = Layer.effect(
	SandboxRedis,
	Effect.map(
		Effect.acquireRelease(
			Effect.sync(() => new Redis(testRedisUrl())),
			(client) => Effect.promise(() => client.quit()),
		),
		(client) => ({ client }),
	),
);

export const deleteRedisKeysOnExit = (keys: () => ReadonlyArray<string>) =>
	Effect.gen(function* () {
		const redis = yield* SandboxRedis;
		yield* Effect.addFinalizer(() => {
			const pending = keys();
			return pending.length === 0
				? Effect.void
				: Effect.promise(() => redis.client.del(...pending));
		});
	});

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
	executeRyotql: unusedHostCall,
	getCachedValue: unusedHostCall,
	setCachedValue: unusedHostCall,
	getPluginConfig: unusedHostCall,
	getUserSettings: unusedHostCall,
	createUserEntity: unusedHostCall,
	updateUserEntity: unusedHostCall,
	getEntitySchemas: unusedHostCall,
	listEventSchemas: unusedHostCall,
	listIntegrations: unusedHostCall,
	sendNotification: unusedHostCall,
	ensureUserEntities: unusedHostCall,
	getPersistentValue: unusedHostCall,
	getUserPreferences: unusedHostCall,
	getProAvailability: unusedHostCall,
	verifyManagedAssets: unusedHostCall,
	getOAuthAccessToken: unusedHostCall,
	claimPersistentValue: unusedHostCall,
	upsertGlobalEntities: unusedHostCall,
	getCurrentIntegration: unusedHostCall,
	requestEventStreamWork: unusedHostCall,
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

declare module "vitest" {
	interface ProvidedContext {
		redisUrl: string;
	}
}
