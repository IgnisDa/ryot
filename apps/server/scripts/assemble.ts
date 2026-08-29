#!/usr/bin/env bun

import { BunRuntime, BunServices } from "@effect/platform-bun";
import { buildClientRuntime, compileClientPluginModule } from "@ryot-app/client-plugin-compiler";
import { Effect, FileSystem, Path, Schema } from "effect";

import {
	CLIENT_API_VERSION,
	PluginClientArtifactFromBase64,
} from "../../../packages/client-plugin-contract/src/index";
import {
	kernelCollectionDetailRenderer,
	kernelEntityBrowserRenderer,
	kernelResultsTableRenderer,
} from "../../../packages/kernel-renderers/src/index";

const ShippedPlugins = Schema.fromJsonString(Schema.Array(Schema.String));
const ClientRuntimeJson = Schema.fromJsonString(
	Schema.Struct({
		artifact: PluginClientArtifactFromBase64,
		entries: Schema.Record(Schema.String, Schema.String),
	}),
);
const KernelRenderersJson = Schema.fromJsonString(
	Schema.Array(
		Schema.Struct({
			name: Schema.String,
			sourceHash: Schema.String,
			artifact: PluginClientArtifactFromBase64,
		}),
	),
);

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
	for (const slug of slugs) {
		const destination = path.join("plugins", `${slug}.zip`);
		yield* fs.remove(path.join("plugins", slug), { force: true, recursive: true });
		yield* fs.copyFile(path.join(packageRoot(slug), `dist/${slug}.zip`), destination);
	}

	const clientRuntime = yield* buildClientRuntime();
	yield* fs.writeFileString(
		path.join("plugins", "client-runtime.json"),
		yield* Schema.encodeEffect(ClientRuntimeJson)(clientRuntime),
	);

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
	yield* fs.writeFileString(
		path.join("plugins", "kernel-renderers.json"),
		yield* Schema.encodeEffect(KernelRenderersJson)(compiledRenderers),
	);
});

if (import.meta.main) {
	BunRuntime.runMain(assemble.pipe(Effect.provide(BunServices.layer)));
}
