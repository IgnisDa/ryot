import { assert, expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import { Effect } from "effect";

import { assertExitFails } from "#lib/test-utils/assertions";

import { decodePluginSourceTextFiles, normalizePluginSource, pluginSourceHash } from "./pipeline";
import { fixtureManifest } from "./test-support";
import { PluginValidationError } from "./validation";

const encoder = new TextEncoder();

it("hashes sorted source paths and exact source bytes", () => {
	const manifest = fixtureManifest();
	const first = {
		"backend/a.ts": encoder.encode("same"),
		"client/image.png": new Uint8Array([0, 255, 1]),
	};
	const reordered = {
		"backend/a.ts": encoder.encode("same"),
		"client/image.png": new Uint8Array([0, 255, 1]),
	};
	const changed = { ...reordered, "client/image.png": new Uint8Array([0, 254, 1]) };

	expect(pluginSourceHash(manifest, first)).toBe(pluginSourceHash(manifest, reordered));
	expect(pluginSourceHash(manifest, changed)).not.toBe(pluginSourceHash(manifest, first));
});

it("hashes compiled script source, JavaScript, and format into package identity", () => {
	const manifest = fixtureManifest();
	const files = {
		[manifest.scripts[0]?.entry ?? "backend/script.sandbox.ts"]: encoder.encode("source"),
	};
	const entry = Object.keys(files)[0];
	assert(entry);
	const script = { entry, format: 1, source: "source", javascript: "export {};" };
	const scripts = [script];
	const sourceHash = pluginSourceHash(manifest, files, scripts);

	expect(
		pluginSourceHash(manifest, files, [{ ...script, javascript: "export const value = 1;" }]),
	).not.toBe(sourceHash);
	expect(pluginSourceHash(manifest, files, [{ ...script, source: "other" }])).not.toBe(sourceHash);
	expect(pluginSourceHash(manifest, files, [{ ...script, format: 2 }])).not.toBe(sourceHash);
});

it("hashes client artifact identity and file contents into package identity", () => {
	const manifest = fixtureManifest();
	const files = {};
	const artifact: PluginClientArtifact = {
		hash: "artifact-hash",
		format: CLIENT_ARTIFACT_FORMAT,
		apiVersion: CLIENT_API_VERSION,
		compilerVersion: CLIENT_COMPILER_VERSION,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		files: [
			{
				name: "plugin.js",
				contents: encoder.encode("export {};"),
				contentType: "text/javascript; charset=utf-8",
			},
		],
	};
	const packageHash = pluginSourceHash(manifest, files, [], artifact);

	expect(pluginSourceHash(manifest, files, [], { ...artifact, hash: "other-artifact" })).not.toBe(
		packageHash,
	);
	const firstArtifactFile = artifact.files[0];
	assert(firstArtifactFile);
	expect(
		pluginSourceHash(manifest, files, [], {
			...artifact,
			files: [{ ...firstArtifactFile, contents: encoder.encode("export const changed = true;") }],
		}),
	).not.toBe(packageHash);
});

it.effect("requires compiled scripts to exactly match manifest entries", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		const entry = manifest.scripts[0]?.entry;
		expect(entry).toBeDefined();
		if (!entry) {
			return;
		}
		const source = "export default {};";
		const error = yield* Effect.flip(
			normalizePluginSource({
				manifest,
				compiledScripts: [],
				files: { [entry]: encoder.encode(source) },
			}),
		);

		expect(error.issues).toEqual([
			"Plugin compiled scripts must exactly match manifest script entries",
		]);
	}),
);

it.effect("rejects a source package with no compiled script collection", () =>
	Effect.gen(function* () {
		const manifest = {
			...fixtureManifest(),
			hooks: [],
			scripts: [],
			entitySchemas: [],
			signalSchemas: [],
			relationshipSchemas: [],
		};
		const error = yield* Effect.flip(normalizePluginSource({ manifest, files: {} }));

		expect(error.issues).toEqual(["Plugin compiled scripts are missing"]);
	}),
);

it.effect("fatally rejects non-UTF-8 plugin source text before normalization", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		const entry = manifest.scripts[0]?.entry;
		expect(entry).toBeDefined();
		if (!entry) {
			return;
		}
		const exit = yield* Effect.exit(
			decodePluginSourceTextFiles({ [entry]: new Uint8Array([0xff]) }),
		);
		assertExitFails(
			exit,
			new PluginValidationError({ issues: ["Plugin source text is not valid UTF-8"] }),
		);
	}),
);
