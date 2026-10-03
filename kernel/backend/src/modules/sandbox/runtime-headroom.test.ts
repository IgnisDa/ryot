import { BunServices } from "@effect/platform-bun";
import { PgClient } from "@effect/sql-pg";
import { expect, layer } from "@effect/vitest";
import { SandboxRunError } from "@ryot-app/contract/errors";
import { SandboxScriptId, UserId } from "@ryot-app/contract/schema/brands";
import {
	type WorkflowDurableResult,
	workflowReplayJournalEntrySchema,
} from "@ryot-app/sandbox-sdk/workflow";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { sortBy } from "@ryot-app/ts-utils/lodash";
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
import { sandboxRuntimeDirectory } from "#lib/test-utils/sandbox-runtime";
import { SandboxCompiler } from "#modules/sandbox/sandbox-compiler";

import { SandboxDurableHostDispatcher } from "./durable-host-dispatcher";
import { SandboxExecutionQueueWorkerLive, processSandboxExecutionQueue } from "./durable-queues";
import { KernelWorkflowReferences } from "./kernel-workflow-references";
import { SandboxRepository } from "./repository";
import { SandboxScriptWorkflowPayload } from "./sandbox-script-workflow-payload";

type CompiledFixture = Effect.Success<ReturnType<SandboxCompiler["Service"]["compile"]>>;

type HeadroomControl = {
	fixture:
		| { readonly compiled: CompiledFixture; readonly principal: SandboxExecutionPrincipal }
		| undefined;
	readonly batches: Array<string>;
	readonly callbackStarts: Array<{ readonly executionId: string; readonly index: number }>;
	readonly pidPairs: Array<{ readonly root: number; readonly nested: number }>;
	readonly rootPids: Array<number>;
	activeBatches: number;
	activeHostCallbacks: number;
	maximumActiveBatches: number;
	maximumActiveHostCallbacks: number;
	readonly fourCallbacksStarted: Deferred.Deferred<void>;
	readonly firstRootEntered: Deferred.Deferred<void>;
	readonly releaseFirstRoot: Deferred.Deferred<void>;
};

class SandboxHeadroomControl extends Context.Service<SandboxHeadroomControl, HeadroomControl>()(
	"test/SandboxHeadroomControl",
) {}

class SandboxHeadroomObserver extends Context.Service<
	SandboxHeadroomObserver,
	{
		readonly schemaName: string;
		readonly applicationName: string;
		readonly countApplicationConnections: Effect.Effect<number, unknown>;
	}
>()("test/SandboxHeadroomObserver") {}

const SandboxHeadroomReplayWorkflow = Workflow.make("SandboxHeadroomReplayWorkflow", {
	error: SandboxRunError,
	payload: SandboxScriptWorkflowPayload,
	idempotencyKey: ({ executionId }) => executionId,
	success: Schema.Array(Schema.Array(workflowReplayJournalEntrySchema)),
});

const unusedEffect = () => Effect.die("Unused sandbox host implementation");
const unusedValue = (): never => {
	throw new Error("Unused sandbox lifecycle host implementation");
};

const makeHostImplementations = (): SandboxHostImplementations["Service"] => ({
	automation: { emitSignal: unusedEffect, sendNotification: unusedEffect },
	runtime: {
		httpCall: unusedEffect,
		setCachedValue: unusedEffect,
		getCachedValue: unusedEffect,
		getPersistentValue: unusedEffect,
		claimPersistentValue: unusedEffect,
	},
	additional: {
		deleteEvents: unusedEffect,
		createEvents: unusedEffect,
		updateEvents: unusedEffect,
		executeRyotql: unusedEffect,
		getPluginConfig: unusedEffect,
		getUserSettings: unusedEffect,
		listIntegrations: unusedEffect,
		listEventSchemas: unusedEffect,
		getEntitySchemas: unusedEffect,
		getUserPreferences: unusedEffect,
		ensureUserEntities: unusedEffect,
		getOAuthAccessToken: unusedEffect,
		upsertGlobalEntities: unusedEffect,
		getCurrentIntegration: unusedEffect,
		requestEventStreamWork: unusedEffect,
		changeUserRelationships: unusedEffect,
		upsertGlobalRelationships: unusedEffect,
	},
	lifecycle: {
		updateEvents: { commit: unusedEffect, validate: unusedEffect },
		deleteEvents: { commit: unusedEffect, validate: unusedEffect },
		upsertGlobalEntities: {
			value: unusedValue,
			commit: unusedEffect,
			prepare: unusedEffect,
			validate: unusedEffect,
			applyPolicies: unusedEffect,
		},
		changeUserRelationships: {
			value: unusedValue,
			commit: unusedEffect,
			prepare: unusedEffect,
			validate: unusedEffect,
			applyPolicies: unusedEffect,
		},
		upsertGlobalRelationships: {
			value: unusedValue,
			commit: unusedEffect,
			prepare: unusedEffect,
			validate: unusedEffect,
			applyPolicies: unusedEffect,
		},
	},
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
		const runtimeDirectory = yield* sandboxRuntimeDirectory;
		const controlFactory: HeadroomControl = {
			batches: [],
			pidPairs: [],
			rootPids: [],
			activeBatches: 0,
			fixture: undefined,
			callbackStarts: [],
			activeHostCallbacks: 0,
			maximumActiveBatches: 0,
			maximumActiveHostCallbacks: 0,
			firstRootEntered: yield* Deferred.make<void>(),
			releaseFirstRoot: yield* Deferred.make<void>(),
			fourCallbacksStarted: yield* Deferred.make<void>(),
		};
		const appConfig = makeAppConfigLayer({
			fileStorage: { localTempDir: root },
			redisUrl: Redacted.make(testRedisUrl()),
			sandbox: { runtimeDirectory, workerConcurrency: 2 },
			database: { poolMax: 7, url: Redacted.make(applicationUrl.toString()) },
		});
		const observerFactory = {
			schemaName,
			applicationName,
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
			Layer.succeed(SandboxHostImplementations, makeHostImplementations()),
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
		const fixtureServices = Layer.mergeAll(
			Layer.succeed(SandboxRepository, repository),
			Layer.succeed(KernelWorkflowReferences, {
				execute: () => Effect.die("Kernel workflow dispatch is unused"),
				resolveArtifactGrants: () => Effect.die("Artifact grants are unused"),
			}),
		);
		const dispatcher = Layer.effect(
			SandboxDurableHostDispatcher,
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const headroomObserver = yield* SandboxHeadroomObserver;
				const admission = yield* SandboxSidecarAdmission;
				const state = yield* SandboxHeadroomControl;
				return SandboxDurableHostDispatcher.of({
					dispatch: () => Effect.die("Non-inline durable dispatch is not expected"),
					settleInline: (requests, _context, _principal, executionId) =>
						Effect.gen(function* () {
							state.batches.push(executionId);
							state.activeBatches += 1;
							state.maximumActiveBatches = Math.max(
								state.maximumActiveBatches,
								state.activeBatches,
							);
							return yield* Effect.forEach(
								requests,
								(request) =>
									Effect.gen(function* () {
										if (
											request.name !== "getCachedValue" ||
											request.args.capability !== "getCachedValue"
										) {
											return yield* Effect.die("Unexpected inline host request");
										}
										state.callbackStarts.push({ executionId, index: request.index });
										if (
											state.callbackStarts.filter((call) => call.executionId === executionId)
												.length === 4
										) {
											yield* Deferred.succeed(state.fourCallbacksStarted, undefined);
										}
										const value = yield* admission.withDatabaseLimit(
											session
												.run((db) =>
													Effect.gen(function* () {
														expect(yield* session.isTransactionActive).toBe(false);
														const [rootRow] = yield* db
															.select({
																pid: sql<number>`pg_backend_pid()`,
																schema: sql<string>`current_schema()`,
																applicationName: sql<string>`current_setting('application_name')`,
															})
															.from(sql`(select 1) as fixture`);
														if (rootRow === undefined) {
															return yield* Effect.die("Root PID query returned no row");
														}
														expect(rootRow.schema).toBe(headroomObserver.schemaName);
														expect(rootRow.applicationName).toBe(headroomObserver.applicationName);
														yield* Effect.sync(() => {
															state.rootPids.push(rootRow.pid);
															state.activeHostCallbacks += 1;
															state.maximumActiveHostCallbacks = Math.max(
																state.maximumActiveHostCallbacks,
																state.activeHostCallbacks,
															);
														});
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
														expect(yield* session.isTransactionActive).toBe(false);
														yield* Effect.sync(() =>
															state.pidPairs.push({ root: rootRow.pid, nested: nested.pid }),
														);
														return request.index + 1;
													}),
												)
												.pipe(
													Effect.ensuring(
														Effect.sync(() => {
															state.activeHostCallbacks -= 1;
														}),
													),
													Effect.orDie,
												),
										);
										return { value, state: "success" } satisfies WorkflowDurableResult;
									}),
								{ concurrency: 4 },
							).pipe(
								Effect.ensuring(
									Effect.sync(() => {
										state.activeBatches -= 1;
									}),
								),
							);
						}),
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
				return yield* Effect.forEach(
					[0, 1],
					(slot) =>
						Effect.gen(function* () {
							const result = yield* processSandboxExecutionQueue({
								startedAt,
								journalLength: 0,
								context: payload.input,
								principal: fixture.principal,
								executionId: `${payload.executionId}-replay-${slot}`,
								workflowExecutionId: `${payload.executionId}-slot-${slot}`,
							});
							expect(result.value).toMatchObject({ state: "completed", output: [1, 2, 3, 4] });
							return result.inline;
						}),
					{ concurrency: 2 },
				);
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
				const uploaderId = UserId.make(testExecutionId("sandbox-headroom-uploader"));
				const scriptId = SandboxScriptId.make(testExecutionId("sandbox-headroom-script"));
				const subject: SandboxExecutionPrincipal["subject"] = {
					type: "user",
					userId: uploaderId,
					accountGeneration: {
						userId: uploaderId,
						token: testExecutionId("sandbox-headroom-account"),
					},
				};
				const compiled = yield* compiler.compile(headroomSource);
				expect(compiled.manifest.capabilities).toContain("getCachedValue");
				const principal: SandboxExecutionPrincipal = {
					subject,
					scriptId,
					providerId: null,
					pluginRevision: null,
					metadata: compiled.manifest,
					standaloneUploaderId: uploaderId,
					scriptSlug: compiled.manifest.slug,
					contentHash: sha256Hex(compiled.javascript),
				};
				yield* Effect.sync(() => {
					control.fixture = { compiled, principal };
				});
				const workflowExecutionId = testExecutionId("sandbox-headroom-workflow");
				const inlineExecutionIds = [
					`${workflowExecutionId}-slot-0`,
					`${workflowExecutionId}-slot-1`,
				];
				const replayExecutionIds = [
					`${workflowExecutionId}-replay-0`,
					`${workflowExecutionId}-replay-1`,
				];
				yield* Effect.addFinalizer(() =>
					redis.del(...replayExecutionIds.map(redisKeys.sandboxRecovery)),
				);
				yield* Effect.addFinalizer(() => Deferred.succeed(control.releaseFirstRoot, undefined));
				const payload: SandboxScriptWorkflowPayload = {
					subject,
					scriptId,
					input: {},
					resolutionMode: "exact",
					executionId: workflowExecutionId,
				};
				const fiber = yield* Effect.forkChild(
					engine.execute(SandboxHeadroomReplayWorkflow, {
						payload,
						executionId: workflowExecutionId,
					}),
				);
				yield* Deferred.await(control.fourCallbacksStarted);
				yield* Deferred.await(control.firstRootEntered);
				expect(control.batches.length).toBeGreaterThanOrEqual(1);
				expect(control.batches.length).toBeLessThanOrEqual(2);
				expect(control.activeBatches).toBeGreaterThanOrEqual(1);
				expect(control.maximumActiveBatches).toBeLessThanOrEqual(2);
				expect(control.callbackStarts.length).toBeGreaterThanOrEqual(4);
				expect(control.callbackStarts.length).toBeLessThanOrEqual(8);
				const blockedExecutionId =
					control.batches[0] ?? (yield* Effect.die("Inline dispatch batch did not start"));
				expect(
					control.callbackStarts.filter((call) => call.executionId === blockedExecutionId),
				).toHaveLength(4);
				expect(control.rootPids).toHaveLength(1);
				expect(control.activeHostCallbacks).toBe(1);
				expect(control.activeBatches).toBeGreaterThanOrEqual(1);
				expect(control.activeBatches).toBeLessThanOrEqual(2);
				expect(admission.snapshot().runs).toBeGreaterThanOrEqual(1);
				expect(admission.snapshot().runs).toBeLessThanOrEqual(2);
				expect(yield* Deferred.isDone(control.releaseFirstRoot)).toBe(false);
				const [application] = yield* session.run((db) =>
					db
						.select({
							pid: sql<number>`pg_backend_pid()`,
							schema: sql<string>`current_schema()`,
							applicationName: sql<string>`current_setting('application_name')`,
						})
						.from(sql`(select 1) as fixture`),
				);
				expect(application?.pid).toBeDefined();
				expect(application?.schema).toBe(observer.schemaName);
				expect(application?.applicationName).toBe(observer.applicationName);
				expect(application?.pid).not.toBe(control.rootPids[0]);
				const connectionsWhileHeld = yield* observer.countApplicationConnections;
				expect(connectionsWhileHeld).toBeGreaterThanOrEqual(2);
				expect(connectionsWhileHeld).toBeLessThanOrEqual(7);
				expect(yield* Deferred.isDone(control.releaseFirstRoot)).toBe(false);
				yield* Deferred.succeed(control.releaseFirstRoot, undefined);
				const outputs = yield* Fiber.join(fiber);
				expect(outputs).toHaveLength(2);
				expect(control.activeBatches).toBe(0);
				expect(control.activeHostCallbacks).toBe(0);
				expect(control.maximumActiveHostCallbacks).toBe(1);
				expect(control.callbackStarts).toHaveLength(8);
				expect(sortBy(control.batches)).toEqual(sortBy(inlineExecutionIds));
				for (const executionId of inlineExecutionIds) {
					expect(control.batches.filter((batch) => batch === executionId)).toHaveLength(1);
					expect(
						sortBy(
							control.callbackStarts.filter((call) => call.executionId === executionId),
							"index",
						).map((call) => call.index),
					).toEqual([0, 1, 2, 3]);
				}
				expect(control.pidPairs).toHaveLength(8);
				for (const pair of control.pidPairs) {
					expect(pair.nested).toBe(pair.root);
				}
				for (const output of outputs) {
					expect(output.map((entry) => entry.request.index)).toEqual([0, 1, 2, 3]);
					expect(output.map((entry) => entry.value)).toEqual(
						[1, 2, 3, 4].map((value) => ({ value, state: "success" })),
					);
				}
				expect(admission.snapshot().runs).toBe(0);
				expect(yield* session.isTransactionActive).toBe(false);
				const [after] = yield* session.run((db) =>
					db.select({ pid: sql<number>`pg_backend_pid()` }).from(sql`(select 1) as fixture`),
				);
				expect(after?.pid).toBeDefined();
				const connectionsAfter = yield* observer.countApplicationConnections;
				expect(connectionsAfter).toBeLessThanOrEqual(7);
				yield* Effect.logInfo("Sandbox dispatch headroom observed").pipe(
					Effect.annotateLogs({
						workerConcurrency: 2,
						applicationConnectionsAfter: connectionsAfter,
						maximumConcurrentQueueBatches: control.maximumActiveBatches,
						maximumLeasedHostCallbacks: control.maximumActiveHostCallbacks,
						applicationConnectionsWhileHostLeaseHeld: connectionsWhileHeld,
					}),
				);
			}),
		),
	);
});
