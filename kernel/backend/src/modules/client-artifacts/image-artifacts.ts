import {
	PluginClientArtifactFromBase64,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import { Context, Data, Effect, FileSystem, Layer, Path, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";

export const ClientImageManifestJson = Schema.fromJsonString(
	Schema.Struct({
		publicArtifactHashes: Schema.Array(Schema.String),
		runtime: Schema.Struct({
			artifact: PluginClientArtifactFromBase64,
			entries: Schema.Record(Schema.String, Schema.String),
		}),
		renderers: Schema.Array(
			Schema.Struct({
				name: Schema.String,
				sourceHash: Schema.String,
				artifact: PluginClientArtifactFromBase64,
			}),
		),
	}),
);

export class ImageClientArtifactsValidationError extends Data.TaggedError(
	"ImageClientArtifactsValidationError",
)<{ message: string }> {}

export const equalArtifacts = (left: PluginClientArtifact, right: PluginClientArtifact) =>
	left.hash === right.hash &&
	left.files.length === right.files.length &&
	left.files.every((file) =>
		right.files.some(
			(other) =>
				file.name === other.name &&
				file.contentType === other.contentType &&
				file.contents.length === other.contents.length &&
				file.contents.every((byte, index) => byte === other.contents[index]),
		),
	);

export const parseClientImageManifest = (manifest: typeof ClientImageManifestJson.Type) =>
	Effect.gen(function* () {
		const imageArtifactsByHash = new Map<string, PluginClientArtifact>();
		for (const artifact of [
			manifest.runtime.artifact,
			...manifest.renderers.map(({ artifact: rendererArtifact }) => rendererArtifact),
		]) {
			const existing = imageArtifactsByHash.get(artifact.hash);
			if (existing && !equalArtifacts(existing, artifact)) {
				return yield* new ImageClientArtifactsValidationError({
					message: `Client image artifact hash collision: ${artifact.hash}`,
				});
			}
			imageArtifactsByHash.set(artifact.hash, artifact);
		}
		const files = new Set(manifest.runtime.artifact.files.map(({ name }) => name));
		const bootstrap = manifest.runtime.entries["bootstrap"];
		if (!bootstrap || !files.has(bootstrap)) {
			return yield* new ImageClientArtifactsValidationError({
				message: bootstrap
					? `Client runtime bootstrap file is missing: ${bootstrap}`
					: "Client runtime is missing its bootstrap entry",
			});
		}
		for (const [entry, filename] of Object.entries(manifest.runtime.entries)) {
			if (!files.has(filename)) {
				return yield* new ImageClientArtifactsValidationError({
					message: `Client runtime entry file is missing for ${entry}: ${filename}`,
				});
			}
		}
		const renderers = new Map<
			string,
			{ readonly sourceHash: string; readonly artifact: PluginClientArtifact }
		>();
		for (const { name, artifact, sourceHash } of manifest.renderers) {
			if (renderers.has(name)) {
				return yield* new ImageClientArtifactsValidationError({
					message: `Duplicate kernel renderer: ${name}`,
				});
			}
			const names = new Set(artifact.files.map((file) => file.name));
			for (const filename of ["module.js", "module.css"]) {
				if (!names.has(filename)) {
					return yield* new ImageClientArtifactsValidationError({
						message: `Kernel renderer ${name} is missing ${filename}`,
					});
				}
			}
			renderers.set(name, { artifact, sourceHash });
		}
		const publicArtifactHashes = new Set(manifest.publicArtifactHashes);
		if (
			publicArtifactHashes.size !== manifest.publicArtifactHashes.length ||
			[...imageArtifactsByHash.keys()].some((hash) => !publicArtifactHashes.has(hash)) ||
			manifest.publicArtifactHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))
		) {
			return yield* new ImageClientArtifactsValidationError({
				message: "Invalid public client image artifact hashes",
			});
		}
		return { renderers, imageArtifactsByHash, publicArtifactHashes, runtime: manifest.runtime };
	});

export class ImageClientArtifacts extends Context.Service<ImageClientArtifacts>()(
	"ImageClientArtifacts",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const manifest = yield* Schema.decodeEffect(ClientImageManifestJson)(
				yield* fs.readFileString(path.join(config.server.pluginsSystemDir, "client-image.json")),
			);
			return yield* parseClientImageManifest(manifest);
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
