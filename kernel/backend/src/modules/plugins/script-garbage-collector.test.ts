import { BunServices } from "@effect/platform-bun";
import { expect, layer } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Context, Effect, FileSystem, Layer, Ref } from "effect";

import { PackageCacheManager } from "#lib/infrastructure/sandbox-runtime/runtime";
import { databaseLayer, makeAppConfigLayer } from "#lib/test-utils/effect";

import { PluginRepository } from "./repository";
import { ScriptGarbageCollector } from "./script-garbage-collector";

const hash = sha256Hex;

class FakeCollectorDependencies extends Context.Service<
	FakeCollectorDependencies,
	{
		readonly moduleDirectory: string;
		readonly lockCount: Effect.Effect<number>;
		readonly observedLiveHashes: Effect.Effect<ReadonlyArray<ReadonlySet<string>>>;
	}
>()("test/FakeCollectorDependencies") {}

class CollectorFakeState extends Context.Service<
	CollectorFakeState,
	{
		readonly moduleDirectory: string;
		readonly lockCount: Ref.Ref<number>;
		readonly deleted: Ref.Ref<boolean>;
		readonly observedLiveHashes: Ref.Ref<ReadonlyArray<ReadonlySet<string>>>;
	}
>()("test/CollectorFakeState") {}

const collectorLayer = (
	input: {
		readonly deleteFailure?: DbError;
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
					lockIngestion: () => Ref.update(state.lockCount, (count) => count + 1),
					listPersistedLivenessContentHashes: () =>
						Effect.succeed([...(input.persistedLivenessHashes ?? [])]),
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
