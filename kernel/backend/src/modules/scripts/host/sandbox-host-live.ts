import { PgClient } from "@effect/sql-pg";
import { isSandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import { bindSandboxHostFunctions } from "@ryot-app/sandbox/host/bridge-adapter";
import { SandboxHostCallScope, SandboxHostConfig } from "@ryot-app/sandbox/host/config";
import { SandboxHostFunctions } from "@ryot-app/sandbox/host/host-functions";
import type { BoundHostFunction, SandboxRunInput } from "@ryot-app/sandbox/host/invocation";
import {
	SandboxStateStore,
	SandboxStateStoreUnavailable,
} from "@ryot-app/sandbox/host/state-store";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Clock, Effect, Layer, Pool } from "effect";
import { Reactivity } from "effect/reactivity";

import { AppConfig, databaseConnectionBudget } from "#platform/config/service";
import { DatabaseConnectionLimit, DatabaseSession } from "#platform/db/session";
import { CurrentJobId } from "#platform/jobs/worker";
import { ServerRun } from "#platform/server-run";
import { transientValue } from "#schema/tables/transient-values";

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

const lockKey = (key: string) => sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;

export const SandboxStateStoreLive = Layer.effect(
	SandboxStateStore,
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const load = (keys: ReadonlyArray<string>) =>
			session.run((db) =>
				db
					.select({ key: transientValue.key, value: transientValue.value })
					.from(transientValue)
					.where(
						and(
							inArray(transientValue.key, [...keys]),
							sql`(${transientValue.expiresAt} is null or ${transientValue.expiresAt} > now())`,
						),
					),
			);
		const unavailable = Effect.mapError(() => new SandboxStateStoreUnavailable());
		return {
			read: (keys) =>
				session.detached(load(keys)).pipe(
					Effect.map((rows) => new Map(rows.map(({ key, value }) => [key, value]))),
					unavailable,
				),
			update: (keys, apply) =>
				session
					.detached(
						session.transaction(
							Effect.gen(function* () {
								for (const key of [...keys].sort()) {
									yield* session.run((db) => db.execute(lockKey(key)));
								}
								const current = new Map((yield* load(keys)).map(({ key, value }) => [key, value]));
								const { result, writes } = apply(current, yield* Clock.currentTimeMillis);
								for (const [key, write] of writes) {
									if (write === null) {
										yield* session.run((db) =>
											db.delete(transientValue).where(eq(transientValue.key, key)),
										);
									} else {
										const expiresAt =
											write.ttlMs === undefined
												? null
												: sql`now() + ${write.ttlMs} * interval '1 millisecond'`;
										yield* session.run((db) =>
											db
												.insert(transientValue)
												.values({ key, expiresAt, value: write.value })
												.onConflictDoUpdate({
													target: transientValue.key,
													set: { expiresAt, value: write.value },
												}),
										);
									}
								}
								return result;
							}),
						),
					)
					.pipe(unavailable),
		};
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
			const jobId = yield* CurrentJobId;
			return Object.fromEntries(
				Object.entries(bindSandboxHostFunctions(implementations, scriptInput))
					.filter(
						([capability]) =>
							isSandboxHostCapability(capability) &&
							isSandboxCapabilityAllowed(scriptInput, capability),
					)
					.map(([capability, bound]): [string, BoundHostFunction] => [
						capability,
						// Host calls run on the resident sidecar's fibers, which keep the job that started it.
						(args) => bound(args).pipe(Effect.provideService(CurrentJobId, jobId)),
					]),
			);
		});
		return { bind };
	}),
);
