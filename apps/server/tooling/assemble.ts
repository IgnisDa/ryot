#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import {
	buildClientRuntime,
	clientPluginCompilerPlatformLayer,
	compileClientPluginModule,
} from "@ryot-app/client-plugin-compiler";
import {
	CLIENT_API_VERSION,
	clientArtifactMetadata,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import {
	ClientImageManifestJson,
	equalArtifacts,
	parseClientImageManifest,
} from "@ryot-app/kernel-backend/modules/client-artifacts/image-artifacts";
import {
	kernelCollectionBrowserRenderer,
	kernelCollectionDetailRenderer,
	kernelEntityBrowserRenderer,
	kernelResultsTableRenderer,
} from "@ryot-app/kernel-renderers";
import { readPluginArchive } from "@ryot-app/plugin-archive";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";

import { readShippedPlugins } from "./shipped-plugins";

const serverRoot = Bun.fileURLToPath(new URL("..", import.meta.url));

const prepareLayout = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	for (const directory of ["plugins", "storage", "work", "tmp"]) {
		yield* fs.makeDirectory(directory, { recursive: true });
	}
	yield* fs.remove("src/drizzle", { force: true, recursive: true });
	yield* fs.symlink("../../../kernel/backend/src/drizzle", "src/drizzle");
});

export const assemble = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const plugins = yield* readShippedPlugins;
	yield* prepareLayout;
	yield* fs.remove("sandboxd", { force: true, recursive: true });
	yield* fs.copy(path.resolve(serverRoot, "../../kernel/sandboxd/dist"), "sandboxd");
	const shippedArtifacts: PluginClientArtifact[] = [];
	for (const plugin of plugins) {
		const destination = path.join("plugins", `${plugin.packageId}.zip`);
		yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
		yield* fs.copyFile(plugin.archive, destination);
		const archive = yield* readPluginArchive(yield* fs.readFile(destination));
		if (archive.compiledClient) {
			if (
				clientArtifactMetadata(
					archive.manifest.metadata.name,
					archive.manifest.metadata.packageId,
					archive.compiledClient.files,
					{
						imports: archive.compiledClient.imports,
						clientDeclarationHash: archive.compiledClient.clientDeclarationHash,
					},
				).hash !== archive.compiledClient.hash
			) {
				return yield* Effect.die(
					new Error(`Shipped plugin ${plugin.packageId} has an invalid client artifact hash`),
				);
			}
			shippedArtifacts.push(archive.compiledClient);
		}
	}

	const clientRuntime = yield* buildClientRuntime;

	const kernelRenderers = [
		kernelCollectionBrowserRenderer,
		kernelEntityBrowserRenderer,
		kernelResultsTableRenderer,
		kernelCollectionDetailRenderer,
	];
	const compiledRenderers = yield* Effect.forEach(kernelRenderers, (renderer) =>
		compileClientPluginModule({
			kind: "kernel",
			name: renderer.name,
			files: renderer.files,
			apiVersion: CLIENT_API_VERSION,
			publicExports: { page: { kind: "page", entry: renderer.definition.entry } },
		}).pipe(
			Effect.map(({ artifact }) => ({
				artifact,
				name: renderer.name,
				sourceHash: renderer.sourceHash,
			})),
		),
	);
	const manifest = {
		runtime: clientRuntime,
		renderers: compiledRenderers,
		publicArtifactHashes: [
			...new Set([
				clientRuntime.artifact.hash,
				...compiledRenderers.map(({ artifact }) => artifact.hash),
				...shippedArtifacts.map(({ hash }) => hash),
			]),
		].sort(),
	};
	const image = yield* parseClientImageManifest(manifest);
	const shippedByHash = new Map<string, PluginClientArtifact>();
	for (const artifact of shippedArtifacts) {
		const existing =
			image.imageArtifactsByHash.get(artifact.hash) ?? shippedByHash.get(artifact.hash);
		if (existing && !equalArtifacts(existing, artifact)) {
			return yield* Effect.die(
				new Error(`Shipped client artifact hash collision: ${artifact.hash}`),
			);
		}
		shippedByHash.set(artifact.hash, artifact);
	}
	return yield* fs.writeFileString(
		path.join("plugins", "client-image.json"),
		yield* Schema.encodeEffect(ClientImageManifestJson)(manifest),
	);
});

if (import.meta.main) {
	BunRuntime.runMain(
		assemble.pipe(
			// oxlint-disable-next-line effecttsgo/strict-effect-provide -- Server assembly is a command-line entrypoint
			Effect.provide(Layer.merge(BunServices.layer, clientPluginCompilerPlatformLayer)),
		),
	);
}
