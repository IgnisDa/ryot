import { assert, expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import { Effect } from "effect";

import { normalizePluginSource, pluginSourceHash } from "./pipeline";
import { fixtureManifest } from "./test-support";

const encoder = new TextEncoder();

it.effect("rejects lossy compiled JavaScript before package identity is accepted", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		const entry = manifest.scripts[0]?.entry;
		assert(entry);
		for (const javascript of ['export default "\ud800";', 'export default "\udfff";']) {
			const error = yield* normalizePluginSource({
				manifest,
				compiledScripts: [{ entry, format: 1, javascript }],
			}).pipe(Effect.flip);
			expect(error.issues).toEqual([
				`Plugin compiled script JavaScript is not valid UTF-8: ${entry}`,
			]);
		}
	}),
);

it("hashes compiled scripts in canonical entry order", () => {
	const manifest = fixtureManifest();
	const first = [
		{ format: 1, entry: "backend/z.ts", javascript: "export const z = 1;" },
		{ format: 1, entry: "backend/a.ts", javascript: "export const a = 1;" },
	];
	const reordered = first.toReversed();

	expect(pluginSourceHash(manifest, first)).toBe(pluginSourceHash(manifest, reordered));
});

it("hashes manifest metadata, compiled JavaScript, entries, and format into package identity", () => {
	const manifest = fixtureManifest();
	const entry = manifest.scripts[0]?.entry;
	assert(entry);
	const script = { entry, format: 1, javascript: "export {};" };
	const scripts = [script];
	const sourceHash = pluginSourceHash(manifest, scripts);

	expect(
		pluginSourceHash(manifest, [{ ...script, javascript: "export const value = 1;" }]),
	).not.toBe(sourceHash);
	expect(pluginSourceHash(manifest, [{ ...script, entry: "backend/other.sandbox.ts" }])).not.toBe(
		sourceHash,
	);
	expect(pluginSourceHash(manifest, [{ ...script, format: 2 }])).not.toBe(sourceHash);
	expect(
		pluginSourceHash(
			{ ...manifest, metadata: { ...manifest.metadata, version: "changed" } },
			scripts,
		),
	).not.toBe(sourceHash);
});

it("hashes client artifact identity and file contents into package identity", () => {
	const manifest = fixtureManifest();
	const artifact: PluginClientArtifact = {
		hash: "artifact-hash",
		format: CLIENT_ARTIFACT_FORMAT,
		apiVersion: CLIENT_API_VERSION,
		compilerVersion: CLIENT_COMPILER_VERSION,
		bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
		files: [
			{ name: "image.png", contentType: "image/png", contents: new Uint8Array([0, 255, 1]) },
			{
				name: "plugin.js",
				contents: encoder.encode("export {};"),
				contentType: "text/javascript; charset=utf-8",
			},
		],
	};
	const packageHash = pluginSourceHash(manifest, [], artifact);
	expect(pluginSourceHash(manifest, [], { ...artifact, files: artifact.files.toReversed() })).toBe(
		packageHash,
	);

	expect(pluginSourceHash(manifest, [], { ...artifact, hash: "other-artifact" })).not.toBe(
		packageHash,
	);
	const firstArtifactFile = artifact.files[0];
	assert(firstArtifactFile);
	expect(
		pluginSourceHash(manifest, [], {
			...artifact,
			files: artifact.files.map((file) =>
				file.name === firstArtifactFile.name
					? { ...file, contents: new Uint8Array([0, 254, 1]) }
					: file,
			),
		}),
	).not.toBe(packageHash);
	expect(
		pluginSourceHash(manifest, [], {
			...artifact,
			files: artifact.files.map((file) =>
				Object.assign({}, file, { contentType: "application/octet-stream" }),
			),
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
		const error = yield* Effect.flip(normalizePluginSource({ manifest, compiledScripts: [] }));

		expect(error.issues).toEqual([
			"Plugin compiled scripts must exactly match manifest script entries",
		]);
	}),
);

it.effect("rejects a package with no compiled script collection", () =>
	Effect.gen(function* () {
		const manifest = {
			...fixtureManifest(),
			hooks: [],
			scripts: [],
			entitySchemas: [],
			signalSchemas: [],
			relationshipSchemas: [],
		};
		const error = yield* Effect.flip(normalizePluginSource({ manifest }));

		expect(error.issues).toEqual(["Plugin compiled scripts are missing"]);
	}),
);
