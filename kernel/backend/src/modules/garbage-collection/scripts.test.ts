import { BunServices } from "@effect/platform-bun";
import { assert, expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { eq, sql } from "drizzle-orm";
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Redacted, Ref } from "effect";

import { PLUGIN_INGESTION_ADVISORY_LOCK_KEY } from "#lib/infrastructure/db/advisory-locks";
import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { PackageCacheManager } from "#lib/infrastructure/sandbox-runtime/runtime";
import { databaseLayer, makeAppConfigLayer, makeConfigProviderLayer } from "#lib/test-utils/effect";
import { IsolatedDatabase, isolatedDatabaseLayer } from "#lib/test-utils/isolated-database";
import { ClientArtifactsRepository } from "#modules/client-artifacts/repository";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { PluginConfigEncryptionKey } from "#modules/plugins/config-encryption-key";
import { PluginConfigRevisions } from "#modules/plugins/config-revisions";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import { installRevisionPackage, revisionPackage } from "#modules/plugins/revision.test-support";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";

import { ScriptGarbageCollector } from "./scripts";

const hash = sha256Hex;
const scheduledCollection = { limit: 500, scheduled: true, now: new Date(0) };

class FakeCollectorDependencies extends Context.Service<
	FakeCollectorDependencies,
	{
		readonly moduleDirectory: string;
		readonly lockCount: Effect.Effect<number>;
		readonly tryLockCount: Effect.Effect<number>;
		readonly observedLiveHashes: Effect.Effect<ReadonlyArray<ReadonlySet<string>>>;
	}
>()("test/FakeCollectorDependencies") {}

class CollectorFakeState extends Context.Service<
	CollectorFakeState,
	{
		readonly moduleDirectory: string;
		readonly lockCount: Ref.Ref<number>;
		readonly tryLockCount: Ref.Ref<number>;
		readonly liveReferences: Ref.Ref<boolean>;
		readonly deleted: Ref.Ref<boolean>;
		readonly observedLiveHashes: Ref.Ref<ReadonlyArray<ReadonlySet<string>>>;
	}
>()("test/CollectorFakeState") {}

const collectorLayer = (
	input: {
		readonly deleteFailure?: DbError;
		readonly pinOnTryLock?: boolean;
		readonly persistedLivenessHashes?: ReadonlyArray<string>;
		readonly unreferencedScriptsOnce?: ReadonlyArray<{ id: string; contentHash: string }>;
	} = {},
) => {
	const stateLayer = Layer.effect(
		CollectorFakeState,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			return {
				lockCount: yield* Ref.make(0),
				deleted: yield* Ref.make(false),
				tryLockCount: yield* Ref.make(0),
				liveReferences: yield* Ref.make(false),
				moduleDirectory: yield* fs.makeTempDirectoryScoped(),
				observedLiveHashes: yield* Ref.make<ReadonlyArray<ReadonlySet<string>>>([]),
			};
		}),
	);
	const fakesLayer = Layer.unwrap(
		Effect.map(CollectorFakeState, (state) =>
			Layer.mergeAll(
				Layer.mock(PluginRepository)({
					pruneRevisionArtifacts: () => Effect.void,
					hasIntegrationReferences: () => Effect.succeed(false),
					deleteInactiveUnreferencedPlugins: () => Effect.succeed([]),
					hasLiveWorkflowReferences: () => Ref.get(state.liveReferences),
					lockIngestion: () => Ref.update(state.lockCount, (count) => count + 1),
					listPersistedLivenessContentHashes: () =>
						Effect.succeed([...(input.persistedLivenessHashes ?? [])]),
					tryLockIngestion: () =>
						Ref.update(state.tryLockCount, (count) => count + 1).pipe(
							Effect.andThen(
								input.pinOnTryLock ? Ref.set(state.liveReferences, true) : Effect.void,
							),
							Effect.as(true),
						),
					deleteUnreferencedScripts: (liveHashes) =>
						input.deleteFailure
							? Effect.fail(input.deleteFailure)
							: Ref.update(state.observedLiveHashes, (values) => [...values, liveHashes]).pipe(
									Effect.andThen(Ref.getAndSet(state.deleted, true)),
									Effect.map((alreadyDeleted) =>
										alreadyDeleted ? [] : [...(input.unreferencedScriptsOnce ?? [])],
									),
								),
				}),
				Layer.succeed(PackageCacheManager, {
					directory: state.moduleDirectory,
					moduleDirectory: state.moduleDirectory,
					cacheDirectory: `${state.moduleDirectory}/cache`,
					importMapPath: `${state.moduleDirectory}/import-map.json`,
				}),
				Layer.succeed(FakeCollectorDependencies, {
					lockCount: Ref.get(state.lockCount),
					moduleDirectory: state.moduleDirectory,
					tryLockCount: Ref.get(state.tryLockCount),
					observedLiveHashes: Ref.get(state.observedLiveHashes),
				}),
			),
		),
	);
	return ScriptGarbageCollector.layer.pipe(
		Layer.provide(Layer.merge(databaseLayer, makeAppConfigLayer())),
		Layer.provideMerge(fakesLayer),
		Layer.provideMerge(stateLayer),
		Layer.provideMerge(BunServices.layer),
	);
};

const activeHash = hash("active");
const pinnedHash = hash("pinned");
const kernelHash = hash("kernel");
const databaseHash = hash("database");
const oldHash = hash("old");

layer(
	collectorLayer({
		unreferencedScriptsOnce: [{ id: "old-script", contentHash: oldHash }],
		persistedLivenessHashes: [activeHash, pinnedHash, databaseHash, kernelHash],
	}),
)((test) => {
	test.effect("retains modules with persisted liveness and deletes the rest", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const fake = yield* FakeCollectorDependencies;
			const { moduleDirectory } = fake;
			for (const [contentHash, contents] of [
				[activeHash, "active"],
				[pinnedHash, "pinned"],
				[kernelHash, "kernel"],
				[databaseHash, "database"],
				[oldHash, "old"],
			] as const) {
				yield* fs.writeFileString(`${moduleDirectory}/${contentHash}.mjs`, contents);
			}

			const collector = yield* ScriptGarbageCollector;
			expect(yield* collector.collect()).toEqual({ removedCount: 2, candidateCount: 2 });
			expect(yield* collector.collect()).toEqual({ removedCount: 0, candidateCount: 0 });

			const observed = yield* fake.observedLiveHashes;
			expect(observed).toHaveLength(2);
			expect(yield* fake.lockCount).toBe(2);
			expect([...(observed[0] ?? [])].sort()).toEqual(
				[activeHash, databaseHash, pinnedHash, kernelHash].sort(),
			);
			expect((yield* fs.readDirectory(moduleDirectory)).sort()).toEqual(
				[
					`${activeHash}.mjs`,
					`${databaseHash}.mjs`,
					`${pinnedHash}.mjs`,
					`${kernelHash}.mjs`,
				].sort(),
			);
		}),
	);
});

layer(collectorLayer({ deleteFailure: new DbError({ message: "script cleanup failed" }) }))(
	(test) => {
		test.effect("surfaces repository deletion failures", () =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const { moduleDirectory } = yield* FakeCollectorDependencies;
				yield* fs.writeFileString(`${moduleDirectory}/${oldHash}.mjs`, "old");
				const collector = yield* ScriptGarbageCollector;
				const exit = yield* Effect.exit(collector.collect());
				expect(exit._tag).toBe("Failure");
				expect(String(exit)).toContain("script cleanup failed");
				expect(yield* fs.exists(`${moduleDirectory}/${oldHash}.mjs`)).toBe(false);
			}),
		);
	},
);

layer(collectorLayer())((test) => {
	test.effect("does not delete rows when the module sweep fails", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const fake = yield* FakeCollectorDependencies;
			yield* fs.makeDirectory(`${fake.moduleDirectory}/${oldHash}.mjs`);

			const collector = yield* ScriptGarbageCollector;
			const exit = yield* Effect.exit(collector.collect());

			expect(exit._tag).toBe("Failure");
			expect(yield* fake.observedLiveHashes).toHaveLength(0);
		}),
	);
});

const rootHash = hash("workflow-root");
const targetHash = hash("historical-activity-target");

layer(collectorLayer({ persistedLivenessHashes: [rootHash, targetHash] }))((test) => {
	test.effect("retains every historical script for a plugin with a nonterminal workflow", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const { moduleDirectory } = yield* FakeCollectorDependencies;
			const obsoleteHash = hash("unreferenced-plugin");
			for (const contentHash of [rootHash, targetHash, obsoleteHash]) {
				yield* fs.writeFileString(`${moduleDirectory}/${contentHash}.mjs`, contentHash);
			}

			const collector = yield* ScriptGarbageCollector;
			yield* collector.collect();

			expect(yield* fs.exists(`${moduleDirectory}/${rootHash}.mjs`)).toBe(true);
			expect(yield* fs.exists(`${moduleDirectory}/${targetHash}.mjs`)).toBe(true);
			expect(yield* fs.exists(`${moduleDirectory}/${obsoleteHash}.mjs`)).toBe(false);
		}),
	);
});

layer(collectorLayer({ pinOnTryLock: true }))((test) => {
	test.effect("defers when a workflow pin commits after scheduled preflight", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const fake = yield* FakeCollectorDependencies;
			yield* fs.writeFileString(`${fake.moduleDirectory}/${oldHash}.mjs`, "old");
			const collector = yield* ScriptGarbageCollector;
			expect(yield* collector.collect(scheduledCollection)).toEqual({
				removedCount: 0,
				candidateCount: 0,
			});
			expect(yield* fs.exists(`${fake.moduleDirectory}/${oldHash}.mjs`)).toBe(true);
			expect(yield* fake.lockCount).toBe(0);
			expect(yield* fake.tryLockCount).toBe(1);
			expect(yield* fake.observedLiveHashes).toEqual([]);
		}),
	);
});

const runtimeLayer = Layer.effect(
	PackageCacheManager,
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const directory = yield* fs.makeTempDirectoryScoped();
		return {
			directory,
			moduleDirectory: directory,
			cacheDirectory: `${directory}/cache`,
			importMapPath: `${directory}/import-map.json`,
		};
	}),
);
const collectorRepositories = Layer.mergeAll(
	ClientArtifactsRepository.layer,
	DefinitionRepository.layer,
	PluginConfigEncryptionKey.layer,
	PluginConfigRevisions.layer,
	PluginInstallationRepository.layer,
	SandboxWorkflowReferenceRepository.layer,
);
const collectorDatabaseLayer = Layer.effectDiscard(
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		yield* session.run((db) =>
			db
				.insert(tables.user)
				.values({
					id: "owner",
					name: "Owner",
					email: "owner@example.test",
					accountGeneration: "test-account-generation",
				}),
		);
	}),
).pipe(
	Layer.provideMerge(
		Layer.mergeAll(
			collectorRepositories,
			PluginRepository.layer.pipe(Layer.provide(collectorRepositories)),
		).pipe(Layer.provideMerge(isolatedDatabaseLayer("script_gc"))),
	),
	Layer.provide(makeConfigProviderLayer()),
);
const realCollectorLayer = ScriptGarbageCollector.layer.pipe(
	Layer.provideMerge(Layer.merge(runtimeLayer, collectorDatabaseLayer)),
	Layer.provideMerge(Layer.merge(BunServices.layer, makeAppConfigLayer())),
);

layer(realCollectorLayer, { excludeTestServices: true })((test) => {
	test.effect("collects an idle scheduled sweep", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const runtime = yield* PackageCacheManager;
			const collector = yield* ScriptGarbageCollector;
			yield* fs.writeFileString(`${runtime.moduleDirectory}/${oldHash}.mjs`, "old");
			expect(yield* collector.collect(scheduledCollection)).toEqual({
				removedCount: 1,
				candidateCount: 1,
			});
			expect(yield* fs.exists(`${runtime.moduleDirectory}/${oldHash}.mjs`)).toBe(false);
		}),
	);

	test.effect("defers for suspension pins while explicit collection preserves their scripts", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const session = yield* DatabaseSession;
			const repository = yield* PluginRepository;
			const references = yield* SandboxWorkflowReferenceRepository;
			const collector = yield* ScriptGarbageCollector;
			const runtime = yield* PackageCacheManager;
			const source = revisionPackage("gc-suspension");
			const installed = yield* installRevisionPackage({
				...source,
				scripts: source.scripts.map((script) =>
					Object.assign({}, script, { contentHash: hash(script.slug) }),
				),
			});
			const [script] = yield* session.run((db) =>
				db
					.select()
					.from(tables.sandboxScript)
					.where(eq(tables.sandboxScript.pluginRevisionId, installed.revisionId))
					.limit(1),
			);
			assert(script !== undefined);
			yield* session.transaction(
				Effect.gen(function* () {
					yield* references.lockIngestionShared();
					yield* references.registerInTransaction({
						pluginId: installed.pluginId,
						contentHash: script.contentHash,
						executionId: "suspended-gc-workflow",
						scriptId: SandboxScriptId.make(script.id),
					});
				}),
			);
			yield* repository.deactivate(installed.pluginId);
			yield* fs.writeFileString(`${runtime.moduleDirectory}/${script.contentHash}.mjs`, "pinned");
			yield* fs.writeFileString(`${runtime.moduleDirectory}/${oldHash}.mjs`, "old");
			expect(yield* collector.collect(scheduledCollection)).toEqual({
				removedCount: 0,
				candidateCount: 0,
			});
			expect(yield* fs.exists(`${runtime.moduleDirectory}/${oldHash}.mjs`)).toBe(true);
			yield* collector.collect();
			expect(yield* fs.exists(`${runtime.moduleDirectory}/${oldHash}.mjs`)).toBe(false);
			expect(yield* fs.exists(`${runtime.moduleDirectory}/${script.contentHash}.mjs`)).toBe(true);
			expect(
				yield* session.run((db) =>
					db
						.select({ id: tables.sandboxScript.id })
						.from(tables.sandboxScript)
						.where(eq(tables.sandboxScript.id, script.id)),
				),
			).toEqual([{ id: script.id }]);
			yield* references.release("suspended-gc-workflow");
			yield* collector.collect(scheduledCollection);
			expect(yield* fs.exists(`${runtime.moduleDirectory}/${script.contentHash}.mjs`)).toBe(false);
		}),
	);

	test.effect(
		"defers without waiting behind a busy ingestion fence and retries after release",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const runtime = yield* PackageCacheManager;
				const collector = yield* ScriptGarbageCollector;
				const { url } = yield* IsolatedDatabase;
				const admin = Context.get(
					yield* Layer.build(
						DatabaseSession.layer.pipe(
							Layer.provide(makeAppConfigLayer({ database: { url: Redacted.make(url) } })),
							Layer.fresh,
						),
					),
					DatabaseSession,
				);
				const held = yield* Deferred.make<void>();
				const release = yield* Deferred.make<void>();
				const holder = yield* Effect.forkChild(
					admin.transaction(
						Effect.gen(function* () {
							yield* admin.run((db) =>
								db.execute(
									sql`select pg_advisory_xact_lock_shared(hashtext(${PLUGIN_INGESTION_ADVISORY_LOCK_KEY}))`,
								),
							);
							yield* Deferred.succeed(held, undefined);
							yield* Deferred.await(release);
						}),
					),
				);
				yield* Deferred.await(held);
				yield* fs.writeFileString(`${runtime.moduleDirectory}/${oldHash}.mjs`, "old");
				const result = yield* collector
					.collect(scheduledCollection)
					.pipe(Effect.timeout("2 seconds"), Effect.ensuring(Deferred.succeed(release, undefined)));
				expect(result).toEqual({ removedCount: 0, candidateCount: 0 });
				expect(yield* fs.exists(`${runtime.moduleDirectory}/${oldHash}.mjs`)).toBe(true);
				yield* Fiber.join(holder);
				expect(yield* collector.collect(scheduledCollection)).toEqual({
					removedCount: 1,
					candidateCount: 1,
				});
				expect(yield* fs.exists(`${runtime.moduleDirectory}/${oldHash}.mjs`)).toBe(false);
			}).pipe(Effect.scoped),
	);
});
