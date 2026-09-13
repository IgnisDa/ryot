import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Effect, Layer, Ref, FileSystem } from "effect";

import { PackageCacheManager } from "#lib/infrastructure/sandbox-runtime/runtime";
import { databaseLayer, makeAppConfigLayer } from "#lib/test-utils/effect";

import { PluginRepository } from "./repository";
import { ScriptGarbageCollector } from "./script-garbage-collector";

const hash = sha256Hex;

const withCollector = <A, E, R>(
	effect: Effect.Effect<A, E, R | ScriptGarbageCollector>,
	input: {
		readonly moduleDirectory: string;
		readonly persistedLivenessHashes?: ReadonlyArray<string>;
		readonly lockIngestion?: PluginRepository["Service"]["lockIngestion"];
		readonly deleteScripts?: PluginRepository["Service"]["deleteUnreferencedScripts"];
	},
) => {
	const repositoryLayer = Layer.mock(PluginRepository)({
		pruneRevisionArtifacts: () => Effect.void,
		hasIntegrationReferences: () => Effect.succeed(false),
		lockIngestion: input.lockIngestion ?? (() => Effect.void),
		deleteInactiveUnreferencedPlugins: () => Effect.succeed([]),
		deleteUnreferencedScripts: input.deleteScripts ?? (() => Effect.succeed([])),
		listPersistedLivenessContentHashes: () =>
			Effect.succeed([...(input.persistedLivenessHashes ?? [])]),
	});
	const runtimeLayer = Layer.succeed(PackageCacheManager, {
		directory: input.moduleDirectory,
		moduleDirectory: input.moduleDirectory,
		cacheDirectory: `${input.moduleDirectory}/cache`,
		importMapPath: `${input.moduleDirectory}/import-map.json`,
	});
	const collectorLayer = ScriptGarbageCollector.layer.pipe(
		Layer.provide(
			Layer.mergeAll(runtimeLayer, repositoryLayer, databaseLayer, makeAppConfigLayer()),
		),
	);
	return effect.pipe(Effect.provide(collectorLayer));
};

it.effect("retains modules with persisted liveness and deletes the rest", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const moduleDirectory = yield* fs.makeTempDirectoryScoped();
			const activeHash = hash("active");
			const pinnedHash = hash("pinned");
			const kernelHash = hash("kernel");
			const databaseHash = hash("database");
			const oldHash = hash("old");
			for (const [contentHash, contents] of [
				[activeHash, "active"],
				[pinnedHash, "pinned"],
				[kernelHash, "kernel"],
				[databaseHash, "database"],
				[oldHash, "old"],
			] as const) {
				yield* fs.writeFileString(`${moduleDirectory}/${contentHash}.mjs`, contents);
			}
			const observedLiveHashes = yield* Ref.make<ReadonlyArray<ReadonlySet<string>>>([]);
			const lockCount = yield* Ref.make(0);
			const deleted = yield* Ref.make(false);
			const deleteScripts = (liveHashes: ReadonlySet<string>) =>
				Ref.update(observedLiveHashes, (values) => [...values, liveHashes]).pipe(
					Effect.andThen(Ref.getAndSet(deleted, true)),
					Effect.map((alreadyDeleted) =>
						alreadyDeleted ? [] : [{ id: "old-script", contentHash: oldHash }],
					),
				);

			yield* withCollector(
				Effect.gen(function* () {
					const collector = yield* ScriptGarbageCollector;
					expect(yield* collector.collect()).toEqual({ removedCount: 2, candidateCount: 2 });
					expect(yield* collector.collect()).toEqual({ removedCount: 0, candidateCount: 0 });
				}),
				{
					deleteScripts,
					moduleDirectory,
					lockIngestion: () => Ref.update(lockCount, (count) => count + 1),
					persistedLivenessHashes: [activeHash, pinnedHash, databaseHash, kernelHash],
				},
			);

			const observed = yield* Ref.get(observedLiveHashes);
			expect(observed).toHaveLength(2);
			expect(yield* Ref.get(lockCount)).toBe(2);
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
	).pipe(Effect.provide(BunServices.layer)),
);

it.effect("surfaces repository deletion failures", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const moduleDirectory = yield* fs.makeTempDirectoryScoped();
			const oldHash = hash("old");
			yield* fs.writeFileString(`${moduleDirectory}/${oldHash}.mjs`, "old");
			const failure = new DbError({ message: "script cleanup failed" });
			const exit = yield* Effect.exit(
				withCollector(
					Effect.gen(function* () {
						const collector = yield* ScriptGarbageCollector;
						yield* collector.collect();
					}),
					{ moduleDirectory, deleteScripts: () => Effect.fail(failure) },
				),
			);
			expect(exit._tag).toBe("Failure");
			expect(String(exit)).toContain("script cleanup failed");
			expect(yield* fs.exists(`${moduleDirectory}/${oldHash}.mjs`)).toBe(false);
		}),
	).pipe(Effect.provide(BunServices.layer)),
);

it.effect("does not delete rows when the module sweep fails", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const moduleDirectory = yield* fs.makeTempDirectoryScoped();
			const oldHash = hash("old");
			yield* fs.makeDirectory(`${moduleDirectory}/${oldHash}.mjs`);
			const deleteCount = yield* Ref.make(0);

			const exit = yield* Effect.exit(
				withCollector(
					Effect.gen(function* () {
						const collector = yield* ScriptGarbageCollector;
						yield* collector.collect();
					}),
					{
						moduleDirectory,
						deleteScripts: () => Ref.update(deleteCount, (count) => count + 1).pipe(Effect.as([])),
					},
				),
			);

			expect(exit._tag).toBe("Failure");
			expect(yield* Ref.get(deleteCount)).toBe(0);
		}),
	).pipe(Effect.provide(BunServices.layer)),
);

it.effect("retains every historical script for a plugin with a nonterminal workflow", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const moduleDirectory = yield* fs.makeTempDirectoryScoped();
			const rootHash = hash("workflow-root");
			const targetHash = hash("historical-activity-target");
			const obsoleteHash = hash("unreferenced-plugin");
			for (const contentHash of [rootHash, targetHash, obsoleteHash]) {
				yield* fs.writeFileString(`${moduleDirectory}/${contentHash}.mjs`, contentHash);
			}

			yield* withCollector(
				Effect.gen(function* () {
					const collector = yield* ScriptGarbageCollector;
					yield* collector.collect();
				}),
				{ moduleDirectory, persistedLivenessHashes: [rootHash, targetHash] },
			);

			expect(yield* fs.exists(`${moduleDirectory}/${rootHash}.mjs`)).toBe(true);
			expect(yield* fs.exists(`${moduleDirectory}/${targetHash}.mjs`)).toBe(true);
			expect(yield* fs.exists(`${moduleDirectory}/${obsoleteHash}.mjs`)).toBe(false);
		}),
	).pipe(Effect.provide(BunServices.layer)),
);
