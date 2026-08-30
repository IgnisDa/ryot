import { badRequest } from "@ryot-app/contract/errors";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";

import type { ArchivePrivatePlugin } from "#modules/backups/archive/schemas";
import {
	buildDefinitionSnapshot,
	DefinitionRegistry,
	definitionSourceFromSnapshot,
	type DefinitionSnapshot,
} from "#modules/definition-registry/service";
import { ClientPluginCompiler } from "#modules/plugins/client-plugin-compiler";

import { PluginIngestionLock } from "./ingestion-lock";
import { mergeManifestDefinitions } from "./loader";
import { compilePluginPackage, pluginSourceHash } from "./pipeline";
import { PluginRepository } from "./repository";
import type { NormalizedPlugin } from "./types";
import {
	decodePluginManifest,
	validatePluginExecutableScripts,
	validatePluginManifestPolicy,
	validatePluginManifestReferences,
	validatePluginPackageLimits,
	validatePluginSourcePaths,
} from "./validation";

export type PreparedBackupPrivatePlugin = Omit<ArchivePrivatePlugin, "files"> & {
	readonly normalized: NormalizedPlugin;
	readonly files: Readonly<Record<string, Uint8Array>>;
};

const asInvalidBackup = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(Effect.mapError((error) => badRequest(String(error))));

export class PluginBackupRestore extends Context.Service<PluginBackupRestore>()(
	"PluginBackupRestore",
	{
		make: Effect.gen(function* () {
			const plugins = yield* PluginRepository;
			const definitions = yield* DefinitionRegistry;
			const ingestionLock = yield* PluginIngestionLock;
			const clientCompiler = yield* ClientPluginCompiler;

			const prepare = Effect.fn("PluginBackupRestore.prepare")(function* (
				packages: ReadonlyArray<ArchivePrivatePlugin>,
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
					const files = Object.fromEntries(
						yield* Effect.forEach(Object.entries(item.files), ([path, contents]) =>
							Schema.decodeUnknownEffect(Schema.Uint8ArrayFromBase64)(contents).pipe(
								asInvalidBackup,
								Effect.map((decoded) => [path, decoded] as const),
							),
						),
					);
					const manifest = yield* asInvalidBackup(decodePluginManifest(item.manifest));
					if (
						manifest.metadata.slug !== item.slug ||
						manifest.metadata.version !== item.version ||
						stableStringify(manifest) !== stableStringify(item.manifest)
					) {
						return yield* badRequest("Backup private plugin metadata is inconsistent");
					}
					if (pluginSourceHash(manifest, files) !== item.sourceHash) {
						return yield* badRequest("Backup private plugin source hash is invalid");
					}
					yield* asInvalidBackup(validatePluginPackageLimits(files, manifest));
					yield* asInvalidBackup(
						validatePluginManifestPolicy(manifest, {
							scope: "user",
							systemSlugs: new Set(system.map(({ slug }) => slug)),
						}),
					);
					yield* asInvalidBackup(validatePluginSourcePaths(files, manifest));
					const normalized = yield* asInvalidBackup(
						compilePluginPackage({ files, manifest, sourceHash: item.sourceHash }).pipe(
							Effect.provideService(ClientPluginCompiler, clientCompiler),
						),
					);
					yield* asInvalidBackup(validatePluginExecutableScripts(normalized));
					prepared.push({ ...item, files, manifest, normalized });
				}
				const candidates = prepared.map(({ key, normalized, slug }) => ({
					slug,
					id: key,
					manifest: normalized.manifest,
				}));
				const composedDefinitions = yield* Effect.try({
					catch: (error) => badRequest(String(error)),
					try: () =>
						buildDefinitionSnapshot(
							mergeManifestDefinitions(
								definitionSourceFromSnapshot(definitions.getSnapshot()),
								candidates,
							),
						),
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
					const pluginId = yield* ingestionLock.persistUserPlugin(item.normalized, {
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
