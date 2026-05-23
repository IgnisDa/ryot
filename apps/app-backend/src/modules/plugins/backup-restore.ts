import { badRequest } from "@ryot/contract/errors";
import type { UserId } from "@ryot/contract/schema/brands";
import { stableStringify } from "@ryot/ts-utils/json";
import { Context, Effect, Layer } from "effect";

import type { V2PrivatePlugin } from "#modules/backups/archive-v2/schemas";
import {
	buildDefinitionSnapshot,
	DefinitionRegistry,
	definitionSourceFromSnapshot,
	type DefinitionSnapshot,
} from "#modules/definition-registry/service";

import { mergeManifestDefinitions } from "./loader";
import { compilePluginPackage, pluginSourceHash } from "./pipeline";
import { PluginRepository } from "./repository";
import type { NormalizedPlugin } from "./types";
import {
	decodePluginManifest,
	validatePluginExecutableScripts,
	validatePluginManifestReferences,
	validatePluginPackageLimits,
	validatePluginSourcePaths,
	validatePrivateManifestSurfaces,
	validatePrivateSlugAvailability,
} from "./validation";

export type PreparedBackupPrivatePlugin = V2PrivatePlugin & {
	readonly normalized: NormalizedPlugin;
};

const asInvalidBackup = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(Effect.mapError((error) => badRequest(String(error))));

export class PluginBackupRestore extends Context.Service<PluginBackupRestore>()(
	"PluginBackupRestore",
	{
		make: Effect.gen(function* () {
			const plugins = yield* PluginRepository;
			const definitions = yield* DefinitionRegistry;

			const prepare = Effect.fn("PluginBackupRestore.prepare")(function* (
				packages: ReadonlyArray<V2PrivatePlugin>,
			) {
				const keys = new Set<string>();
				const slugs = new Set<string>();
				const system = yield* plugins.listPortablePluginMetadata();
				const prepared: PreparedBackupPrivatePlugin[] = [];
				for (const item of packages) {
					if (keys.has(item.key) || slugs.has(item.slug)) {
						return yield* badRequest("Backup contains duplicate private plugin identity");
					}
					keys.add(item.key);
					slugs.add(item.slug);
					const manifest = yield* asInvalidBackup(decodePluginManifest(item.manifest));
					if (
						manifest.metadata.slug !== item.slug ||
						manifest.metadata.version !== item.version ||
						stableStringify(manifest) !== stableStringify(item.manifest)
					) {
						return yield* badRequest("Backup private plugin metadata is inconsistent");
					}
					if (pluginSourceHash(manifest, item.files) !== item.sourceHash) {
						return yield* badRequest("Backup private plugin source hash is invalid");
					}
					yield* asInvalidBackup(validatePluginPackageLimits(item.files, manifest));
					yield* asInvalidBackup(validatePrivateManifestSurfaces(manifest));
					yield* asInvalidBackup(validatePluginSourcePaths(item.files, manifest.scripts));
					yield* asInvalidBackup(
						validatePrivateSlugAvailability(item.slug, new Set(system.map(({ slug }) => slug))),
					);
					const normalized = yield* asInvalidBackup(
						compilePluginPackage({ files: item.files, manifest, sourceHash: item.sourceHash }),
					);
					yield* asInvalidBackup(validatePluginExecutableScripts(normalized));
					prepared.push({ ...item, manifest, normalized });
				}
				const candidates = prepared.map(({ key, normalized, slug }) => ({
					id: key,
					slug,
					manifest: normalized.manifest,
				}));
				const composedDefinitions = yield* Effect.try({
					try: () =>
						buildDefinitionSnapshot(
							mergeManifestDefinitions(
								definitionSourceFromSnapshot(definitions.getSnapshot()),
								candidates,
							),
						),
					catch: (error) => badRequest(String(error)),
				});
				for (const candidate of prepared) {
					yield* asInvalidBackup(
						validatePluginManifestReferences(candidate.normalized.manifest, composedDefinitions),
					);
				}
				return prepared;
			});

			const persist = Effect.fn("PluginBackupRestore.persist")(function* (
				userId: UserId,
				prepared: ReadonlyArray<PreparedBackupPrivatePlugin>,
			) {
				const pluginIdByKey = new Map<string, string>();
				for (const item of prepared) {
					const pluginId = yield* plugins.persist(item.normalized, {
						scope: "user",
						slug: item.slug,
						ownerId: userId,
					});
					pluginIdByKey.set(item.key, pluginId);
				}
				return pluginIdByKey;
			});

			const buildDefinitions = Effect.fn("PluginBackupRestore.buildDefinitions")(function* (
				prepared: ReadonlyArray<PreparedBackupPrivatePlugin>,
				pluginIdByKey: ReadonlyMap<string, string>,
			) {
				return yield* Effect.try({
					try: (): DefinitionSnapshot =>
						buildDefinitionSnapshot(
							mergeManifestDefinitions(
								definitionSourceFromSnapshot(definitions.getSnapshot()),
								prepared.map((item) => ({
									slug: item.slug,
									manifest: item.normalized.manifest,
									id: pluginIdByKey.get(item.key) ?? item.key,
								})),
							),
						),
					catch: (error) => badRequest(String(error)),
				});
			});

			return { persist, prepare, buildDefinitions };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
