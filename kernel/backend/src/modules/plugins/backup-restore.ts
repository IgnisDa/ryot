import { badRequest } from "@ryot-app/contract/errors";
import { pluginPackageKey } from "@ryot-app/contract/modules/plugins/references";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer } from "effect";

import type { ArchivePrivatePlugin } from "#modules/backups/archive/schemas";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import {
	buildDefinitionSnapshot,
	definitionSourceFromSnapshot,
	type DefinitionSnapshot,
} from "#modules/definition-registry/snapshot";
import { mergeManifestDefinitions } from "#modules/definition-registry/source";

import { normalizePluginPackage, normalizePluginSource } from "./pipeline";
import { PluginRepository } from "./repository";
import type { NormalizedPlugin } from "./types";
import {
	decodePluginManifest,
	validatePluginExecutableScripts,
	validatePluginManifestPolicy,
	validatePluginManifestReferences,
	validatePluginScriptEntries,
} from "./validation";

type PreparedBackupPrivatePlugin = ArchivePrivatePlugin & { readonly normalized: NormalizedPlugin };

const asInvalidBackup = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(Effect.mapError((error) => badRequest(String(error))));

export class PluginBackupRestore extends Context.Service<PluginBackupRestore>()(
	"PluginBackupRestore",
	{
		make: Effect.gen(function* () {
			const plugins = yield* PluginRepository;
			const definitions = yield* DefinitionRepository;

			const prepare = Effect.fn("PluginBackupRestore.prepare")(function* (
				packages: ReadonlyArray<ArchivePrivatePlugin>,
			) {
				const keys = new Set<string>();
				const packageIds = new Set<string>();
				const prepared: PreparedBackupPrivatePlugin[] = [];
				for (const item of packages) {
					if (
						keys.has(item.key) ||
						packageIds.has(item.packageId) ||
						item.key !== pluginPackageKey({ scope: "user", packageId: item.packageId })
					) {
						return yield* badRequest("Backup contains duplicate private plugin identity");
					}
					keys.add(item.key);
					packageIds.add(item.packageId);
					const manifest = yield* asInvalidBackup(decodePluginManifest(item.manifest));
					if (
						manifest.metadata.packageId !== item.packageId ||
						manifest.metadata.version !== item.version ||
						stableStringify(manifest) !== stableStringify(item.manifest)
					) {
						return yield* badRequest("Backup private plugin metadata is inconsistent");
					}
					const normalizedSource = yield* asInvalidBackup(
						normalizePluginSource({
							manifest,
							compiledScripts: item.compiledScripts,
							...(item.compiledClient ? { compiledClient: item.compiledClient } : {}),
						}),
					);
					if (normalizedSource.sourceHash !== item.sourceHash) {
						return yield* badRequest("Backup private plugin source hash is invalid");
					}
					yield* asInvalidBackup(
						validatePluginManifestPolicy(manifest, { scope: "user", systemPackageIds: new Set() }),
					);
					yield* asInvalidBackup(validatePluginScriptEntries(manifest));
					const normalized = normalizePluginPackage(normalizedSource);
					yield* asInvalidBackup(validatePluginExecutableScripts(normalized));
					prepared.push({ ...item, manifest, normalized });
				}
				for (const candidate of prepared) {
					yield* asInvalidBackup(validatePluginManifestReferences(candidate.normalized.manifest));
				}
				return prepared;
			});

			const persist = Effect.fn("PluginBackupRestore.persist")(function* (
				userId: UserId,
				prepared: ReadonlyArray<PreparedBackupPrivatePlugin>,
			) {
				const pluginIdByKey = new Map<string, string>();
				yield* plugins.lockIngestion();
				for (const item of prepared) {
					const pluginId = yield* plugins.persist(item.normalized, {
						scope: "user",
						ownerId: userId,
						packageId: item.packageId,
					});
					pluginIdByKey.set(item.key, pluginId);
				}
				return pluginIdByKey;
			});

			const buildDefinitions = Effect.fn("PluginBackupRestore.buildDefinitions")(function* (
				prepared: ReadonlyArray<PreparedBackupPrivatePlugin>,
				pluginIdByKey: ReadonlyMap<string, string>,
			) {
				const global = definitionSourceFromSnapshot(yield* definitions.getGlobalSnapshot);
				const candidates: Array<Parameters<typeof mergeManifestDefinitions>[1][number]> = [];
				for (const item of prepared) {
					const id = pluginIdByKey.get(item.key);
					if (!id) {
						return yield* badRequest("Backup private plugin mapping is incomplete");
					}
					candidates.push({ id, manifest: item.normalized.manifest });
				}
				return yield* Effect.try({
					catch: (error) => badRequest(String(error)),
					try: (): DefinitionSnapshot =>
						buildDefinitionSnapshot(mergeManifestDefinitions(global, candidates)),
				});
			});

			return { persist, prepare, buildDefinitions, lockIngestion: plugins.lockIngestion() };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
