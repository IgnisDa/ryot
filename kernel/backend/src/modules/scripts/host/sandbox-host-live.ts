import { PgClient } from "@effect/sql-pg";
import { SandboxHostCallScope, SandboxHostConfig } from "@ryot-app/sandbox/host/config";
import { SandboxHostFunctions } from "@ryot-app/sandbox/host/host-functions";
import { SandboxRedis } from "@ryot-app/sandbox/host/redis";
import { Effect, Layer, Pool } from "effect";
import { Reactivity } from "effect/reactivity";

import { AppConfig, databaseConnectionBudget } from "#lib/infrastructure/config/service";
import { DatabaseConnectionLimit } from "#lib/infrastructure/db/session";
import { RedisService } from "#lib/infrastructure/redis";
import { ServerRun } from "#lib/infrastructure/server-run";

import { ScriptHostImplementations } from "./host-implementations";

export const SandboxHostConfigLive = Layer.effect(
	SandboxHostConfig,
	Effect.gen(function* () {
		const config = yield* AppConfig;
		const serverRun = yield* ServerRun;
		return {
			runId: serverRun.id,
			tempDirectory: config.fileStorage.localTempDir,
			perUserSidecars: config.sandbox.perUserSidecars,
			memoryBudgetMiB: config.sandbox.memoryBudgetMiB,
			workerConcurrency: config.sandbox.workerConcurrency,
		};
	}),
);

export const SandboxHostCallScopeLive = Layer.effect(
	SandboxHostCallScope,
	Effect.gen(function* () {
		const config = yield* AppConfig;
		const reactivity = yield* Reactivity.make;
		const database = yield* Pool.makeWithTTL({
			min: 0,
			timeToLive: "60 seconds",
			max: databaseConnectionBudget(config).sandboxDispatch,
			acquire: PgClient.makeClient({
				url: config.database.url,
				connectTimeout: config.database.connectionTimeoutMs,
			}).pipe(Effect.provideService(Reactivity.Reactivity, reactivity)),
		});
		return {
			bound: <A, E, R>(effect: Effect.Effect<A, E, R>) =>
				effect.pipe(Effect.provideService(DatabaseConnectionLimit, database)),
		};
	}),
);

export const SandboxRedisLive = Layer.effect(
	SandboxRedis,
	Effect.gen(function* () {
		const { client } = yield* RedisService;
		return { client };
	}),
);

export const SandboxHostFunctionsLive = Layer.effect(
	SandboxHostFunctions,
	Effect.gen(function* () {
		const { runtime, additional, automation } = yield* ScriptHostImplementations;
		return { ...runtime, ...additional, ...automation };
	}),
);
