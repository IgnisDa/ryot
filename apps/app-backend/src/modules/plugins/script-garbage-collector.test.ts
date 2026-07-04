import { BunServices } from "@effect/platform-bun";
import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot/contract/errors";
import { SandboxScriptId } from "@ryot/contract/schema/brands";
import { sha256Hex } from "@ryot/ts-utils/crypto";
import { Effect, Layer, Ref, FileSystem } from "effect";
import { assert } from "vitest";

import { PackageCacheManager } from "#lib/infrastructure/sandbox-runtime/runtime";
import { transactionLayer } from "#lib/test-utils/effect";
import { makeDefinitionRegistry } from "#modules/definition-registry/service";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";

import { makePluginLoader, PluginLoader } from "./loader";
import { PluginRepository } from "./repository";
import { ScriptGarbageCollector } from "./script-garbage-collector";
import { fixtureManifest } from "./test-support";
import type { NormalizedPlugin } from "./types";

const hash = sha256Hex;

const withCollector = <A, E, R>(
	effect: Effect.Effect<A, E, R | ScriptGarbageCollector>,
	input: {
		readonly moduleDirectory: string;
		readonly pluginHashes?: ReadonlyArray<string>;
		readonly pinnedHashes?: ReadonlyArray<string>;
		readonly repositoryHashes?: ReadonlyArray<string>;
		readonly repositoryList?: PluginRepository["Service"]["list"];
		readonly persistedLivenessHashes?: ReadonlyArray<string>;
		readonly lockIngestion?: PluginRepository["Service"]["lockIngestion"];
		readonly deleteScripts?: PluginRepository["Service"]["deleteUnreferencedScripts"];
	},
) => {
	const loader = makePluginLoader(makeDefinitionRegistry());
	const manifest = fixtureManifest();
	loader.rebuild([
		{
			manifest,
			sourceHash: "active-source",
			scripts: manifest.scripts.map((script, index) => {
				const { entry, ...metadata } = script;
				return {
					entry,
					metadata,
					source: "source",
					slug: script.slug,
					name: script.name,
					compiledFormat: 1,
					compiledCode: "compiled",
					contentHash: input.pluginHashes?.[index] ?? hash(`active-${index}`),
				};
			}),
		} satisfies NormalizedPlugin,
	]);
	const loadedPlugin = loader.getSnapshot().plugins["fixture"];
	assert(loadedPlugin);
	const loaderLayer = Layer.succeed(PluginLoader, {
		...loader,
	});
	const repositoryLayer = Layer.mock(PluginRepository)({
		lockIngestion: input.lockIngestion ?? (() => Effect.void),
		hasIntegrationReferences: () => Effect.succeed(false),
		deleteUnreferencedScripts: input.deleteScripts ?? (() => Effect.succeed([])),
		listPersistedLivenessContentHashes: () =>
			Effect.succeed([...(input.persistedLivenessHashes ?? [])]),
		list:
			input.repositoryList ??
			(() =>
				Effect.succeed(
					input.repositoryHashes
						? [
								{
									...loadedPlugin,
									status: "active" as const,
									scripts: loadedPlugin.scripts.map((script, index) =>
										Object.assign({}, script, {
											contentHash: input.repositoryHashes?.[index] ?? script.contentHash,
										}),
									),
								},
							]
						: [],
				)),
	});
	const referencesLayer = Layer.mock(SandboxWorkflowReferenceRepository)({
		listReferences: () =>
			Effect.succeed(
				(input.pinnedHashes ?? []).map((contentHash, index) => ({
					contentHash,
					pluginSlug: "historical",
					executionId: `execution-${index}`,
					scriptId: SandboxScriptId.make(`script-${index}`),
				})),
			),
	});
	const runtimeLayer = Layer.succeed(PackageCacheManager, {
		directory: input.moduleDirectory,
		moduleDirectory: input.moduleDirectory,
		cacheDirectory: `${input.moduleDirectory}/cache`,
		importMapPath: `${input.moduleDirectory}/import-map.json`,
	});
	const collectorLayer = ScriptGarbageCollector.layer.pipe(
		Layer.provide(
			Layer.mergeAll(loaderLayer, runtimeLayer, repositoryLayer, transactionLayer, referencesLayer),
		),
	);
	return effect.pipe(Effect.provide(collectorLayer));
};

it.effect(
	"waits for kernel readiness and retains local, database, pinned, and kernel modules",
	() =>
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
						expect(yield* collector.collect()).toBeUndefined();
						expect(yield* Ref.get(observedLiveHashes)).toEqual([]);
						expect(yield* Ref.get(lockCount)).toBe(0);
						yield* collector.recordKernelContentHashes(new Set([kernelHash]));
						expect(yield* collector.collect()).toEqual({ candidateCount: 2, removedCount: 2 });
						expect(yield* collector.collect()).toEqual({ candidateCount: 0, removedCount: 0 });
					}),
					{
						deleteScripts,
						moduleDirectory,
						pluginHashes: [activeHash],
						pinnedHashes: [pinnedHash],
						repositoryHashes: [databaseHash],
						persistedLivenessHashes: [pinnedHash],
						lockIngestion: () => Ref.update(lockCount, (count) => count + 1),
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
						yield* collector.recordKernelContentHashes(new Set());
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
						yield* collector.recordKernelContentHashes(new Set());
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
					yield* collector.recordKernelContentHashes(new Set());
					yield* collector.collect();
				}),
				{
					moduleDirectory,
					pinnedHashes: [rootHash],
					persistedLivenessHashes: [rootHash, targetHash],
				},
			);

			expect(yield* fs.exists(`${moduleDirectory}/${rootHash}.mjs`)).toBe(true);
			expect(yield* fs.exists(`${moduleDirectory}/${targetHash}.mjs`)).toBe(true);
			expect(yield* fs.exists(`${moduleDirectory}/${obsoleteHash}.mjs`)).toBe(false);
		}),
	).pipe(Effect.provide(BunServices.layer)),
);

it.effect("retains persisted source-zero hashes absent from the local kernel set", () =>
	Effect.scoped(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const moduleDirectory = yield* fs.makeTempDirectoryScoped();
			const localHash = hash("new-kernel-version");
			const persistedHash = hash("old-kernel-version");
			for (const contentHash of [localHash, persistedHash]) {
				yield* fs.writeFileString(`${moduleDirectory}/${contentHash}.mjs`, contentHash);
			}

			yield* withCollector(
				Effect.gen(function* () {
					const collector = yield* ScriptGarbageCollector;
					yield* collector.recordKernelContentHashes(new Set([localHash]));
					yield* collector.collect();
				}),
				{ moduleDirectory, persistedLivenessHashes: [persistedHash] },
			);

			expect(yield* fs.exists(`${moduleDirectory}/${localHash}.mjs`)).toBe(true);
			expect(yield* fs.exists(`${moduleDirectory}/${persistedHash}.mjs`)).toBe(true);
		}),
	).pipe(Effect.provide(BunServices.layer)),
);
