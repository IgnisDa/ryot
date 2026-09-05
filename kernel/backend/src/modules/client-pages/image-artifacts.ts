import { PluginClientArtifactFromBase64 } from "@ryot-app/client-plugin-contract";
import { Context, Data, Effect, FileSystem, Layer, Path, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";

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

class ImageClientArtifactsValidationError extends Data.TaggedError(
	"ImageClientArtifactsValidationError",
)<{ message: string }> {}

const validateRuntime = (runtime: Schema.Schema.Type<typeof ClientRuntimeJson>) =>
	Effect.gen(function* () {
		const files = new Set(runtime.artifact.files.map(({ name }) => name));
		const bootstrap = runtime.entries["bootstrap"];
		if (bootstrap === undefined || !files.has(bootstrap)) {
			return yield* new ImageClientArtifactsValidationError({
				message:
					bootstrap === undefined
						? "Client runtime is missing its bootstrap entry"
						: `Client runtime bootstrap file is missing: ${bootstrap}`,
			});
		}

		for (const [entry, filename] of Object.entries(runtime.entries)) {
			if (!files.has(filename)) {
				return yield* new ImageClientArtifactsValidationError({
					message: `Client runtime entry file is missing for ${entry}: ${filename}`,
				});
			}
		}

		return runtime;
	});

const validateRenderers = (renderers: Schema.Schema.Type<typeof KernelRenderersJson>) =>
	Effect.gen(function* () {
		for (const { name, artifact } of renderers) {
			const files = new Set(artifact.files.map(({ name: filename }) => filename));
			for (const filename of ["module.js", "module.css"] as const) {
				if (!files.has(filename)) {
					return yield* new ImageClientArtifactsValidationError({
						message: `Kernel renderer ${name} is missing ${filename}`,
					});
				}
			}
		}

		return renderers;
	});

export class ImageClientArtifacts extends Context.Service<ImageClientArtifacts>()(
	"ImageClientArtifacts",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const runtimePath = path.join(config.server.pluginsSystemDir, "client-runtime.json");
			const renderersPath = path.join(config.server.pluginsSystemDir, "kernel-renderers.json");
			const runtime = yield* Schema.decodeEffect(ClientRuntimeJson)(
				yield* fs.readFileString(runtimePath),
			);
			const renderers = yield* Schema.decodeEffect(KernelRenderersJson)(
				yield* fs.readFileString(renderersPath),
			);

			return {
				runtime: yield* validateRuntime(runtime),
				renderers: new Map(
					(yield* validateRenderers(renderers)).map(({ name, artifact, sourceHash }) => [
						name,
						{ artifact, sourceHash },
					]),
				),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
