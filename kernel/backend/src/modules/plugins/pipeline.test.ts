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

it.effect("accepts format 1 output when audited imports match canonical facts", () =>
	Effect.gen(function* () {
		const fixture = fixtureManifest();
		const script = fixture.scripts[0];
		assert(script);
		const entry = script.entry;
		const manifest = { ...fixture, scripts: [{ ...script, runtimeImports: ["effect"] }] };
		const normalized = yield* normalizePluginSource({
			manifest,
			compiledScripts: [{ entry, format: 1, javascript: 'import "effect"; export {};' }],
		});
		expect(normalized.manifest.scripts[0]?.runtimeImports).toEqual(["effect"]);
	}),
);

it.effect("rejects non-format-1, unknown, and nonliteral archive output", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		const script = manifest.scripts[0];
		assert(script);
		for (const archive of [
			{ format: 2, javascript: "export {};" },
			{ format: 1, javascript: 'import "unknown"; export {};' },
			{ format: 1, javascript: "await import(specifier); export {};" },
		]) {
			const error = yield* normalizePluginSource({
				manifest,
				compiledScripts: [{ entry: script.entry, ...archive }],
			}).pipe(Effect.flip);
			let expectedIssue = "non-literal dynamic import";
			if (archive.format !== 1) {
				expectedIssue = "Plugin compiled script is invalid";
			} else if (archive.javascript.includes("unknown")) {
				expectedIssue = "unapproved external import";
			}
			expect(error.issues[0]).toContain(expectedIssue);
		}
	}),
);

it.effect("rejects forged and missing archive runtime import facts", () =>
	Effect.gen(function* () {
		const manifest = fixtureManifest();
		const script = manifest.scripts[0];
		assert(script);
		const forged = yield* normalizePluginSource({
			manifest,
			compiledScripts: [
				{ format: 1, entry: script.entry, javascript: 'import "effect"; export {};' },
			],
		}).pipe(Effect.flip);
		expect(forged.issues).toEqual([
			`Plugin compiled script runtime imports do not match its manifest: ${script.entry}`,
		]);

		const { runtimeImports, ...scriptWithoutRuntimeImports } = script;
		expect(runtimeImports).toEqual([]);
		const missing = yield* normalizePluginSource({
			manifest: { ...manifest, scripts: [scriptWithoutRuntimeImports] },
			compiledScripts: [{ format: 1, entry: script.entry, javascript: "export {};" }],
		}).pipe(Effect.flip);
		expect(missing.issues.join("\n")).toContain("runtimeImports");
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
