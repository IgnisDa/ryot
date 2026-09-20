import { BunServices } from "@effect/platform-bun";
import { PgClient } from "@effect/sql-pg";
import { assert, expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import type { WorkflowDurableResult } from "@ryot-app/sandbox-sdk/workflow";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { sql } from "drizzle-orm";
import {
	Clock,
	Context,
	DateTime,
	Deferred,
	Effect,
	FileSystem,
	Fiber,
	Layer,
	Redacted,
	Schema,
} from "effect";
import { PersistedQueue } from "effect/persistence";
import { Reactivity } from "effect/reactivity";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { PgClientLive } from "#lib/infrastructure/db/postgres";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { RedisService, redisKeys } from "#lib/infrastructure/redis";
import {
	SandboxExecutionAuthority,
	type SandboxExecutionPrincipal,
} from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { SandboxHostImplementations } from "#lib/infrastructure/sandbox-runtime/host-implementations";
import { SandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { SandboxSidecarAdmission } from "#lib/infrastructure/sandbox-runtime/sidecar-admission";
import { ServerRun } from "#lib/infrastructure/server-run";
import { WorkflowEngineLive } from "#lib/infrastructure/workflow";
import { implementWorkflow } from "#lib/infrastructure/workflow-scope";
import {
	applyBaselineMigration,
	baselineMigrationStatements,
} from "#lib/test-utils/baseline-migration";
import { testDatabaseUrl } from "#lib/test-utils/database";
import { makeAppConfigLayer } from "#lib/test-utils/effect";
import { testExecutionId, testRedisUrl } from "#lib/test-utils/redis";
import { unusedSandboxHostImplementations } from "#lib/test-utils/sandbox-host-implementations";
import { makeUserPluginRevision } from "#lib/test-utils/sandbox-runtime";
import { SandboxCompiler } from "#modules/sandbox/sandbox-compiler";

import { SandboxDurableHostDispatcher } from "./durable-host-dispatcher";
import { SandboxExecutionQueueWorkerLive, processSandboxExecutionQueue } from "./durable-queues";
import { SandboxRepository } from "./repository";
import {
	compiledArtifactsLayer,
	unusedKernelWorkflowReferencesLayer,
} from "./sandbox-fixtures.test-support";
import { SandboxScriptWorkflowPayload } from "./sandbox-script-workflow-payload";

type CompiledFixture = Effect.Success<ReturnType<SandboxCompiler["Service"]["compile"]>>;

type HeadroomControl = {
	fixture:
		| { readonly compiled: CompiledFixture; readonly principal: SandboxExecutionPrincipal }
		| undefined;
	readonly callbackStarts: Array<string>;
	readonly pidPairs: Array<{ readonly root: number; readonly nested: number }>;
	readonly rootPids: Array<number>;
	readonly fourCallbacksStarted: Deferred.Deferred<void>;
	readonly firstRootEntered: Deferred.Deferred<void>;
	readonly releaseFirstRoot: Deferred.Deferred<void>;
};

class SandboxHeadroomControl extends Context.Service<SandboxHeadroomControl, HeadroomControl>()(
	"test/SandboxHeadroomControl",
) {}

class SandboxHeadroomObserver extends Context.Service<
	SandboxHeadroomObserver,
	{ readonly countApplicationConnections: Effect.Effect<number, unknown> }
>()("test/SandboxHeadroomObserver") {}

const SandboxHeadroomReplayWorkflow = Workflow.make("SandboxHeadroomReplayWorkflow", {
	success: Schema.Void,
	error: SandboxRunError,
	payload: SandboxScriptWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
});

const headroomSource = `
import { defineManifest, defineScript } from "@ryot-app/sandbox-sdk/driver";
import { Effect, Schema } from "@ryot-app/sandbox-sdk/effect";

export const manifest = defineManifest({
  kind: "script",
  name: "Sandbox runtime headroom",
  slug: "sandbox-runtime-headroom",
});

export default defineScript({
  manifest,
  input: Schema.Struct({}),
  output: Schema.Array(Schema.Number),
  run: (_input, host) => Effect.all(
    ["key-0", "key-1", "key-2", "key-3"].map((key) =>
      host.getCachedValue(key).pipe(Effect.map(Number)),
    ),
    { concurrency: 4 },
  ),
});
`;

const makeHeadroomLayer = Layer.unwrap(
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const admin = yield* PgClient.make({ url: Redacted.make(testDatabaseUrl()) });
		const schemaName = `sandbox_headroom_${crypto.randomUUID().replaceAll("-", "")}`;
		const applicationName = `ryot_sandbox_headroom_${crypto.randomUUID().replaceAll("-", "")}`;
		yield* Effect.acquireRelease(admin.unsafe(`CREATE SCHEMA "${schemaName}"`), () =>
			admin.unsafe(`DROP SCHEMA "${schemaName}" CASCADE`).pipe(Effect.orDie),
		);
		const applicationUrl = new URL(testDatabaseUrl());
		applicationUrl.searchParams.set("options", `-c search_path=${schemaName}`);
		applicationUrl.searchParams.set("application_name", applicationName);
		const temporaryRoot = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-sandbox-headroom-" });
		const root = yield* fs.realPath(temporaryRoot);
		const controlFactory: HeadroomControl = {
			pidPairs: [],
			rootPids: [],
			callbackStarts: [],
			fixture: undefined,
			firstRootEntered: yield* Deferred.make<void>(),
			releaseFirstRoot: yield* Deferred.make<void>(),
			fourCallbacksStarted: yield* Deferred.make<void>(),
		};
		const appConfig = makeAppConfigLayer({
			sandbox: { workerConcurrency: 2 },
			fileStorage: { localTempDir: root },
			redisUrl: Redacted.make(testRedisUrl()),
			database: { poolMax: 7, url: Redacted.make(applicationUrl.toString()) },
		});
		const observerFactory = {
			countApplicationConnections: admin
				.unsafe(
					`SELECT count(*)::int AS connections FROM pg_stat_activity WHERE application_name = '${applicationName}'`,
				)
				.pipe(
					Effect.flatMap(
						Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ connections: Schema.Int }))),
					),
					Effect.flatMap((rows) => {
						const [row] = rows;
						return row
							? Effect.succeed(row.connections)
							: Effect.die("pg_stat_activity returned no connection count");
					}),
				),
		};
		const database = DatabaseSession.layer.pipe(Layer.provideMerge(appConfig));
		const migration = Layer.effectDiscard(
			Effect.gen(function* () {
				const statements = yield* baselineMigrationStatements();
				const session = yield* DatabaseSession;
				yield* session.run((db) =>
					applyBaselineMigration(statements, (statement) => db.execute(sql.raw(statement))),
				);
			}),
		).pipe(Layer.provideMerge(database));
		const infrastructure = Layer.mergeAll(
			Layer.succeed(SandboxHeadroomControl, controlFactory),
			Layer.succeed(SandboxHeadroomObserver, observerFactory),
			Layer.succeed(ServerRun, { id: testExecutionId("sandbox-headroom-server") }),
			Layer.succeed(SandboxExecutionAuthority, { resolve: (_principal) => Effect.succeed("user") }),
			Layer.succeed(SandboxHostImplementations, unusedSandboxHostImplementations()),
		).pipe(
			Layer.provideMerge(RedisService.layer),
			Layer.provideMerge(BunServices.layer),
			Layer.provideMerge(Reactivity.layer),
			Layer.provideMerge(migration),
		);
		const sandboxRuntime = Layer.mergeAll(SandboxService.layer, SandboxCompiler.layer).pipe(
			Layer.provide(infrastructure),
		);
		const workflowInfrastructure = Layer.mergeAll(
			WorkflowEngineLive,
			PersistedQueue.layer.pipe(
				Layer.provide(
					PersistedQueue.layerStoreSql({ tableName: "effect_queue" }).pipe(
						Layer.provide(PgClientLive),
					),
				),
			),
		).pipe(Layer.provide(infrastructure));
		const repository: SandboxRepository["Service"] = {
			isPluginScript: () => Effect.succeed(false),
			resolveWorkflowCallScript: () => Effect.succeed(null),
			getScriptPin: () => Effect.die("Sandbox script pinning is unused"),
			getScript: (scriptId) =>
				Effect.suspend(() => {
					const fixture = controlFactory.fixture;
					return fixture
						? Effect.succeed({
								id: scriptId,
								providerId: null,
								metadata: fixture.compiled.manifest,
								compiledFormat: fixture.compiled.format,
								compiledCode: fixture.compiled.javascript,
								contentHash: fixture.principal.contentHash,
							})
						: Effect.die("Sandbox fixture was not compiled before queue execution");
				}),
		};
		const repositoryLayer = Layer.succeed(SandboxRepository, repository);
		const artifactLayer = compiledArtifactsLayer(repositoryLayer);
		const fixtureServices = Layer.mergeAll(artifactLayer, unusedKernelWorkflowReferencesLayer);
		const dispatcher = Layer.effect(
			SandboxDurableHostDispatcher,
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const admission = yield* SandboxSidecarAdmission;
				const state = yield* SandboxHeadroomControl;
				return SandboxDurableHostDispatcher.of({
					cancelInline: () => Effect.void,
					dispatch: () => Effect.die("Non-inline durable dispatch is not expected"),
					settleInline: (requests, _context, _principal, _lane, executionId) =>
						Effect.forEach(
							requests,
							(request) =>
								Effect.gen(function* () {
									assert(request.kind === "host");
									state.callbackStarts.push(executionId);
									if (state.callbackStarts.filter((id) => id === executionId).length === 4) {
										yield* Deferred.succeed(state.fourCallbacksStarted, undefined);
									}
									const value = yield* admission.withDatabaseLimit(
										session
											.run((db) =>
												Effect.gen(function* () {
													const [rootRow] = yield* db
														.select({ pid: sql<number>`pg_backend_pid()` })
														.from(sql`(select 1) as fixture`);
													if (rootRow === undefined) {
														return yield* Effect.die("Root PID query returned no row");
													}
													state.rootPids.push(rootRow.pid);
													if (state.rootPids.length === 1) {
														yield* Deferred.succeed(state.firstRootEntered, undefined);
														yield* Deferred.await(state.releaseFirstRoot);
													}
													const [nested] = yield* session.run((nestedDb) =>
														nestedDb
															.select({ pid: sql<number>`pg_backend_pid()` })
															.from(sql`(select 1) as fixture`),
													);
													if (nested === undefined) {
														return yield* Effect.die("Nested PID query returned no row");
													}
													state.pidPairs.push({ root: rootRow.pid, nested: nested.pid });
													return request.index + 1;
												}),
											)
											.pipe(Effect.orDie),
									);
									return { value, state: "success" } satisfies WorkflowDurableResult;
								}),
							{ concurrency: 4 },
						),
				});
			}),
		);
		const executionServices = Layer.mergeAll(
			infrastructure,
			workflowInfrastructure,
			sandboxRuntime,
			fixtureServices,
			dispatcher.pipe(Layer.provide(Layer.merge(sandboxRuntime, infrastructure))),
		);
		const worker = SandboxExecutionQueueWorkerLive.pipe(Layer.provideMerge(executionServices));
		const workflow = implementWorkflow(SandboxHeadroomReplayWorkflow, (payload) =>
			Effect.gen(function* () {
				const control = yield* SandboxHeadroomControl;
				const fixture = control.fixture;
				if (fixture === undefined) {
					return yield* Effect.die("Sandbox fixture principal was not installed");
				}
				const startedAt = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
				yield* Effect.forEach(
					[0, 1],
					(slot) =>
						processSandboxExecutionQueue({
							startedAt,
							journalLength: 0,
							lane: "background",
							context: payload.input,
							principal: fixture.principal,
							executionId: `${payload.executionId}-replay-${slot}`,
							workflowExecutionId: `${payload.executionId}-slot-${slot}`,
						}).pipe(Effect.orDie),
					{ discard: true, concurrency: 2 },
				);
				return undefined;
			}),
		).pipe(Layer.provideMerge(worker));
		return workflow;
	}),
).pipe(Layer.provideMerge(Layer.merge(BunServices.layer, Reactivity.layer)));

layer(makeHeadroomLayer, { excludeTestServices: true })((test) => {
	test.effect("sandbox_dispatch_preserves_database_pool_headroom", () =>
		Effect.scoped(
			Effect.gen(function* () {
				const redis = yield* RedisService;
				const engine = yield* WorkflowEngine;
				const session = yield* DatabaseSession;
				const compiler = yield* SandboxCompiler;
				const control = yield* SandboxHeadroomControl;
				const observer = yield* SandboxHeadroomObserver;
				const admission = yield* SandboxSidecarAdmission;
				const ownerId = UserId.make(testExecutionId("sandbox-headroom-owner"));
				const scriptId = SandboxScriptId.make(testExecutionId("sandbox-headroom-script"));
				const subject: SandboxExecutionPrincipal["subject"] = {
					type: "user",
					userId: ownerId,
					accountGeneration: {
						userId: ownerId,
						token: testExecutionId("sandbox-headroom-account"),
					},
				};
				const compiled = yield* compiler.compile(headroomSource);
				const contentHash = sha256Hex(compiled.javascript);
				const principal: SandboxExecutionPrincipal = {
					subject,
					scriptId,
					contentHash,
					providerId: null,
					metadata: compiled.manifest,
					scriptSlug: compiled.manifest.slug,
					pluginRevision: makeUserPluginRevision({
						ownerId,
						slug: testExecutionId("sandbox-headroom-plugin"),
						compiledHashes: { [compiled.manifest.slug]: contentHash },
					}),
				};
				yield* Effect.sync(() => {
					control.fixture = { compiled, principal };
				});
				const workflowExecutionId = testExecutionId("sandbox-headroom-workflow");
				yield* Effect.addFinalizer(() =>
					redis.del(
						...[0, 1].map((slot) =>
							redisKeys.sandboxRecovery(`${workflowExecutionId}-replay-${slot}`),
						),
					),
				);
				yield* Effect.addFinalizer(() => Deferred.succeed(control.releaseFirstRoot, undefined));
				const fiber = yield* Effect.forkChild(
					engine.execute(SandboxHeadroomReplayWorkflow, {
						executionId: workflowExecutionId,
						payload: {
							subject,
							scriptId,
							input: {},
							lane: "interactive",
							resolutionMode: "exact",
							executionId: workflowExecutionId,
						},
					}),
				);
				yield* Deferred.await(control.fourCallbacksStarted);
				yield* Deferred.await(control.firstRootEntered);
				const [application] = yield* session.run((db) =>
					db.select({ pid: sql<number>`pg_backend_pid()` }).from(sql`(select 1) as fixture`),
				);
				expect(application?.pid).not.toBe(control.rootPids[0]);
				const connectionsWhileHeld = yield* observer.countApplicationConnections;
				expect(connectionsWhileHeld).toBeGreaterThanOrEqual(2);
				expect(connectionsWhileHeld).toBeLessThanOrEqual(7);
				yield* Deferred.succeed(control.releaseFirstRoot, undefined);
				yield* Fiber.join(fiber);
				expect(control.pidPairs).not.toHaveLength(0);
				for (const pair of control.pidPairs) {
					expect(pair.nested).toBe(pair.root);
				}
				expect(admission.snapshot().runs).toBe(0);
			}),
		),
	);
});
