import { expect, layer } from "@effect/vitest";
import { clientArtifactFile, clientArtifactMetadata } from "@ryot-app/client-plugin-contract";
import { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { readPluginArchive, writePluginArchive } from "@ryot-app/plugin-archive";
import { sandboxCompilerPlatformLayer } from "@ryot-app/sandbox-compiler/platform";
import { Effect, Schema } from "effect";

import { normalizePluginSource } from "./pipeline";
import { loadPluginSource } from "./source.test-support";
import { fixtureManifest, fixturePackageRoot } from "./test-support";

const manifest = () => ({
	...fixtureManifest(),
	client: {
		homeView: null,
		apiVersion: 1 as const,
		exports: {
			card: {
				entry: "client/card.tsx",
				kind: "component" as const,
				automaticEntityPresentations: false,
			},
		},
	},
});

layer(sandboxCompilerPlatformLayer)((test) => {
	test.effect("accepts the precompiled client artifact when its content hash matches", () =>
		Effect.gen(function* () {
			const pluginManifest = {
				...fixtureManifest(),
				client: manifest().client,
			} satisfies PluginManifest;
			const source = yield* loadPluginSource(fixturePackageRoot(), pluginManifest);
			const normalized = yield* normalizePluginSource(source);

			expect(normalized.compiledClient?.hash).toBe(source.compiledClient?.hash);
			expect(normalized.sourceHash).toMatch(/^[a-f0-9]{64}$/);
		}),
	);

	test.effect("preserves BOM-prefixed compiled JavaScript from archive through ingestion", () =>
		Effect.gen(function* () {
			const pluginManifest = {
				...fixtureManifest(),
				client: manifest().client,
			} satisfies PluginManifest;
			const source = yield* loadPluginSource(fixturePackageRoot(), pluginManifest);
			const compiledManifest = yield* Schema.decodeEffect(PluginManifest)(source.manifest);
			const compiledClient = source.compiledClient;
			expect(compiledClient).toBeDefined();
			if (!compiledClient) {
				return;
			}
			const files = compiledClient.files.map((file) => {
				if (file.name !== "plugin.js") {
					return file;
				}
				return clientArtifactFile({
					path: file.name,
					contentType: file.contentType,
					bytes: new TextEncoder().encode("\ufeffexport {};\n"),
				});
			});
			const artifact = { ...clientArtifactMetadata(pluginManifest.metadata.name, files), files };
			const compiledScripts = source.compiledScripts.map((script) => ({
				...script,
				javascript: `\ufeff${script.javascript}`,
			}));
			const archive = writePluginArchive({
				...source,
				compiledScripts,
				compiledClient: artifact,
				manifest: compiledManifest,
			});
			const decoded = yield* readPluginArchive(archive);
			const normalized = yield* normalizePluginSource(decoded);
			expect(normalized.compiledClient).toEqual(artifact);
			expect(normalized.compiledScripts).toEqual(compiledScripts);
		}),
	);

	test.effect("rejects a client manifest without its precompiled client artifact", () =>
		Effect.gen(function* () {
			const pluginManifest = {
				...fixtureManifest(),
				client: manifest().client,
			} satisfies PluginManifest;
			const source = yield* loadPluginSource(fixturePackageRoot(), pluginManifest);
			const error = yield* Effect.flip(
				normalizePluginSource({
					manifest: source.manifest,
					compiledScripts: source.compiledScripts,
				}),
			);

			expect(error.issues).toEqual([
				"Plugin client manifest is missing its compiled client artifact",
			]);
		}),
	);

	test.effect("rejects a precompiled client artifact with an invalid content hash", () =>
		Effect.gen(function* () {
			const pluginManifest = {
				...fixtureManifest(),
				client: manifest().client,
			} satisfies PluginManifest;
			const source = yield* loadPluginSource(fixturePackageRoot(), pluginManifest);
			const compiledClient = source.compiledClient;
			expect(compiledClient).toBeDefined();
			if (!compiledClient) {
				return;
			}
			const error = yield* Effect.flip(
				normalizePluginSource({
					...source,
					compiledClient: { ...compiledClient, hash: "0".repeat(64) },
				}),
			);

			expect(error.issues).toEqual(["Plugin compiled client artifact content hash is invalid"]);
		}),
	);

	test.effect("rejects invalid UTF-8 compiled client JavaScript with a valid artifact hash", () =>
		Effect.gen(function* () {
			const pluginManifest = {
				...fixtureManifest(),
				client: manifest().client,
			} satisfies PluginManifest;
			const source = yield* loadPluginSource(fixturePackageRoot(), pluginManifest);
			const compiledClient = source.compiledClient;
			expect(compiledClient).toBeDefined();
			if (!compiledClient) {
				return;
			}
			const files = compiledClient.files.map((file) =>
				file.name === "plugin.js"
					? clientArtifactFile({
							path: file.name,
							contentType: file.contentType,
							bytes: new Uint8Array([0xff]),
						})
					: file,
			);
			const artifact = { ...clientArtifactMetadata(pluginManifest.metadata.name, files), files };
			const error = yield* normalizePluginSource({ ...source, compiledClient: artifact }).pipe(
				Effect.flip,
			);
			expect(error.issues).toContain("Plugin compiled client artifact file is invalid: plugin.js");
		}),
	);
});
