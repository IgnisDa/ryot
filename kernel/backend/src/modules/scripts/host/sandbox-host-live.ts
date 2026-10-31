import { PgClient } from "@effect/sql-pg";
import { isSandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import { bindSandboxHostFunctions } from "@ryot-app/sandbox/host/bridge-adapter";
import { SandboxHostCallScope, SandboxHostConfig } from "@ryot-app/sandbox/host/config";
import { SandboxHostFunctions } from "@ryot-app/sandbox/host/host-functions";
import type { SandboxRunInput } from "@ryot-app/sandbox/host/invocation";
import { SandboxRedis } from "@ryot-app/sandbox/host/redis";
import { Effect, Layer, Pool } from "effect";
import { Reactivity } from "effect/reactivity";

import { AppConfig, databaseConnectionBudget } from "#platform/config/service";
import { DatabaseConnectionLimit } from "#platform/db/session";
import { RedisService } from "#platform/redis";
import { ServerRun } from "#platform/server-run";

import { isSandboxCapabilityAllowed } from "../authorization/capabilities";
import { decodeScriptExecutionPrincipal } from "../authorization/principal";
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
		const implementations = { ...runtime, ...additional, ...automation };
		const bind = Effect.fn("SandboxHostFunctions.bind")(function* (input: SandboxRunInput) {
			const principal = yield* decodeScriptExecutionPrincipal(input.principal);
			const scriptInput = { ...input, principal };
			return Object.fromEntries(
				Object.entries(bindSandboxHostFunctions(implementations, scriptInput)).filter(
					([capability]) =>
						isSandboxHostCapability(capability) &&
						isSandboxCapabilityAllowed(scriptInput, capability),
				),
			);
		});
		return { bind };
	}),
);
