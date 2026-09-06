#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { buildClientRuntime, compileClientPluginModule } from "@ryot-app/client-plugin-compiler";
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
	kernelCollectionDetailRenderer,
	kernelEntityBrowserRenderer,
	kernelResultsTableRenderer,
} from "@ryot-app/kernel-renderers";
import { readPluginArchive } from "@ryot-app/plugin-archive";
import { Effect, FileSystem, Path, Schema } from "effect";

const ShippedPlugins = Schema.fromJsonString(Schema.Array(Schema.String));
const serverRoot = Bun.fileURLToPath(new URL("..", import.meta.url));

const packageRoot = (slug: string) =>
	Bun.fileURLToPath(new URL(`../../../plugins/${slug}`, import.meta.url));

export const readShippedSlugs = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	return yield* Schema.decodeEffect(ShippedPlugins)(
		yield* fs.readFileString(path.join(serverRoot, "shipped-plugins.json")),
	);
});

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
	const slugs = yield* readShippedSlugs;
	yield* prepareLayout;
	const shippedArtifacts: PluginClientArtifact[] = [];
	for (const slug of slugs) {
		const destination = path.join("plugins", `${slug}.zip`);
		yield* fs.remove(path.join("plugins", slug), { force: true, recursive: true });
		yield* fs.copyFile(path.join(packageRoot(slug), `dist/${slug}.zip`), destination);
		const archive = yield* readPluginArchive(yield* fs.readFile(destination));
		if (archive.compiledClient) {
			if (
				clientArtifactMetadata(archive.manifest.metadata.name, archive.compiledClient.files)
					.hash !== archive.compiledClient.hash
			) {
				return yield* Effect.die(
					new Error(`Shipped plugin ${slug} has an invalid client artifact hash`),
				);
			}
			shippedArtifacts.push(archive.compiledClient);
		}
	}

	const clientRuntime = yield* buildClientRuntime();

	const kernelRenderers = [
		kernelEntityBrowserRenderer,
		kernelResultsTableRenderer,
		kernelCollectionDetailRenderer,
	];
	const compiledRenderers = yield* Effect.forEach(kernelRenderers, (renderer) =>
		compileClientPluginModule({
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
	BunRuntime.runMain(assemble.pipe(Effect.provide(BunServices.layer)));
}
