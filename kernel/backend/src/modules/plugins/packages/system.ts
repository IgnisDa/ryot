import { readPluginArchive, type PluginArchivePackage } from "@ryot-app/plugin-archive";
import { Context, Effect, FileSystem, Layer, Path } from "effect";

import { AppConfig } from "#platform/config/service";

import { PluginValidationError } from "./validation";

export const discoverSystemPlugins = Effect.fn("discoverSystemPlugins")(function* (root: string) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	if (!(yield* fs.exists(root))) {
		return [];
	}

	const archivePaths: Array<string> = [];
	for (const publisher of (yield* fs.readDirectory(root)).sort()) {
		const publisherPath = path.join(root, publisher);
		if ((yield* fs.stat(publisherPath)).type !== "Directory") {
			continue;
		}
		for (const filename of (yield* fs.readDirectory(publisherPath)).sort()) {
			const archivePath = path.join(publisherPath, filename);
			if (filename.endsWith(".zip") && (yield* fs.stat(archivePath)).type === "File") {
				archivePaths.push(archivePath);
			}
		}
	}
	const sources: Array<PluginArchivePackage> = [];
	for (const archivePath of archivePaths) {
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
