import { BunServices } from "@effect/platform-bun";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
} from "@ryot-app/client-plugin-contract";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { expect, it } from "vitest";

import { makeAppConfigLayer } from "#lib/test-utils/effect";

import { ImageClientArtifacts } from "./image-artifacts";

const artifactFile = (name: string, contentType = "text/javascript") => ({
	name,
	contentType,
	contents: Buffer.from(`contents of ${name}`).toString("base64"),
});

const artifact = (files: ReadonlyArray<ReturnType<typeof artifactFile>>) => ({
	files,
	hash: "artifact-hash",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
});

const documents = {
	renderers: [
		{
			name: "Renderer",
			sourceHash: "renderer-source-hash",
			artifact: artifact([artifactFile("module.js"), artifactFile("module.css", "text/css")]),
		},
	],
	runtime: {
		entries: { react: "entry-react.js", bootstrap: "entry-bootstrap.js" },
		artifact: artifact([artifactFile("entry-bootstrap.js"), artifactFile("entry-react.js")]),
	},
};

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const withArtifactFiles = <A, E, R>(
	input: { readonly runtime?: unknown; readonly renderers?: unknown },
	use: Effect.Effect<A, E, R>,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const root = yield* fs.makeTempDirectoryScoped({ prefix: "ryot-client-artifacts-" });
			if (input.runtime !== undefined) {
				yield* fs.writeFileString(
					path.join(root, "client-runtime.json"),
					encodeJson(input.runtime),
				);
			}
			if (input.renderers !== undefined) {
				yield* fs.writeFileString(
					path.join(root, "kernel-renderers.json"),
					encodeJson(input.renderers),
				);
			}
			const artifactsLayer = ImageClientArtifacts.layer.pipe(
				Layer.provide(
					Layer.mergeAll(
						BunServices.layer,
						makeAppConfigLayer({ server: { pluginsSystemDir: root } }),
					),
				),
			);
			return yield* use.pipe(Effect.provide(artifactsLayer));
		}),
	).pipe(Effect.provide(BunServices.layer));

const loadArtifacts = Effect.gen(function* () {
	const artifacts = yield* ImageClientArtifacts;
	return artifacts;
});

it("decodes the runtime and renderer artifacts from the configured plugin directory", () =>
	Effect.runPromise(
		withArtifactFiles(documents, loadArtifacts).pipe(
			Effect.map((loaded) => {
				expect(loaded.runtime.entries).toEqual(documents.runtime.entries);
				expect(loaded.runtime.artifact.files[0]?.contents).toEqual(
					new Uint8Array(Buffer.from("contents of entry-bootstrap.js")),
				);
				expect(loaded.renderers.get("Renderer")).toMatchObject({
					sourceHash: "renderer-source-hash",
					artifact: { files: [{ name: "module.js" }, { name: "module.css" }] },
				});
			}),
		),
	));

it("rejects a runtime whose bootstrap artifact file is missing", () =>
	Effect.runPromise(
		Effect.flip(
			withArtifactFiles(
				{
					renderers: documents.renderers,
					runtime: { ...documents.runtime, artifact: artifact([artifactFile("entry-react.js")]) },
				},
				loadArtifacts,
			),
		).pipe(
			Effect.map((failure) => {
				expect(String(failure)).toContain("bootstrap file is missing");
			}),
		),
	));

it("rejects runtime entries and renderer modules that are absent from their artifacts", () =>
	Effect.runPromise(
		Effect.flip(
			withArtifactFiles(
				{
					renderers: documents.renderers,
					runtime: {
						...documents.runtime,
						entries: { ...documents.runtime.entries, react: "missing-entry.js" },
					},
				},
				loadArtifacts,
			),
		).pipe(
			Effect.map((failure) => {
				expect(String(failure)).toContain("entry file is missing for react");
			}),
		),
	));

it("rejects renderer artifacts without both emitted modules", () =>
	Effect.runPromise(
		Effect.flip(
			withArtifactFiles(
				{
					runtime: documents.runtime,
					renderers: [
						{ ...documents.renderers[0], artifact: artifact([artifactFile("module.js")]) },
					],
				},
				loadArtifacts,
			),
		).pipe(
			Effect.map((failure) => {
				expect(String(failure)).toContain("Renderer is missing module.css");
			}),
		),
	));
