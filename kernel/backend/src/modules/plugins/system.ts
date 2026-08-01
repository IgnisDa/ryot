import { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { Context, Data, Effect, FileSystem, Layer, Path, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";

import { loadPluginSource } from "./source";
import type { PluginSource } from "./types";

type SystemPluginSource = Omit<PluginSource, "manifest"> & {
	readonly manifest: Schema.Schema.Type<typeof PluginManifest>;
};

export class SystemPluginDiscoveryError extends Data.TaggedError("SystemPluginDiscoveryError")<{
	readonly message: string;
}> {}

export const discoverSystemPlugins = Effect.fn("discoverSystemPlugins")(function* (root: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	if (!(yield* fs.exists(root))) {
		return [];
	}

	const directories = yield* fs.readDirectory(root);
	const sources: Array<SystemPluginSource> = [];
	for (const directory of directories.sort()) {
		const bundleRoot = path.join(root, directory);
		const manifestPath = path.join(bundleRoot, "manifest.json");
		if (!(yield* fs.exists(manifestPath))) {
			continue;
		}
		const info = yield* fs.stat(bundleRoot);
		if (info.type !== "Directory") {
			continue;
		}
		const manifestSource = yield* fs.readFileString(manifestPath);
		const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PluginManifest))(
			manifestSource,
		).pipe(
			Effect.mapError(
				(error) =>
					new SystemPluginDiscoveryError({
						message: `Invalid system plugin manifest at ${manifestPath}: ${String(error)}`,
					}),
			),
		);
		const source = yield* loadPluginSource(bundleRoot, manifest);
		sources.push({ files: source.files, manifest });
	}
	return sources;
});

export class SystemPlugins extends Context.Service<SystemPlugins>()("SystemPlugins", {
	make: Effect.gen(function* () {
		const config = yield* AppConfig;
		const sources = yield* discoverSystemPlugins(config.server.pluginsSystemDir);
		return {
			sources,
			slugs: new Set(sources.map(({ manifest }) => manifest.metadata.slug)) as ReadonlySet<string>,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
