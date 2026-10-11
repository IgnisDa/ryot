import { readPluginArchive, type PluginArchivePackage } from "@ryot-app/plugin-archive";
import { Context, Effect, FileSystem, Layer, Path } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";

import { PluginValidationError } from "./validation";

export const discoverSystemPlugins = Effect.fn("discoverSystemPlugins")(function* (root: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	if (!(yield* fs.exists(root))) {
		return [];
	}

	const entries = yield* fs.readDirectory(root);
	const sources: Array<PluginArchivePackage> = [];
	for (const filename of entries.filter((entry) => entry.endsWith(".zip")).sort()) {
		const archivePath = path.join(root, filename);
		const info = yield* fs.stat(archivePath);
		if (info.type !== "File") {
			continue;
		}
		const source = yield* readPluginArchive(yield* fs.readFile(archivePath));
		if (
			sources.some(
				({ manifest }) => manifest.metadata.packageId === source.manifest.metadata.packageId,
			)
		) {
			return yield* new PluginValidationError({
				issues: [`Duplicate bundled package identity ${source.manifest.metadata.packageId}`],
			});
		}
		sources.push(source);
	}
	return sources;
});

export class SystemPlugins extends Context.Service<SystemPlugins>()("SystemPlugins", {
	make: Effect.gen(function* () {
		const config = yield* AppConfig;
		const sources = yield* discoverSystemPlugins(config.server.pluginsSystemDir);
		const packageIds = new Set(sources.map(({ manifest }) => manifest.metadata.packageId));
		return { sources, packageIds };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
