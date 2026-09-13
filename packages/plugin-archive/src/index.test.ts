import { describe, expect, it } from "@effect/vitest";
import {
	CLIENT_API_VERSION,
	CLIENT_ARTIFACT_FORMAT,
	CLIENT_BRIDGE_PROTOCOL_VERSION,
	CLIENT_COMPILER_VERSION,
	type PluginClientArtifact,
} from "@ryot-app/client-plugin-contract";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { Effect, Schema } from "effect";
import { unzipSync, Zip, zipSync, ZipDeflate } from "fflate";

import type { PluginArchiveErrorReason, PluginArchivePackage } from "./index";
import { PLUGIN_ARCHIVE_LIMITS, readPluginArchive, writePluginArchive } from "./index";

const encoder = new TextEncoder();

const compareNames = (left: string, right: string) => {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
};

const fixture = {
	compiledScripts: [],
	files: {
		"client/d.svg": new Uint8Array([0xff, 0x00, 0x7f]),
		"client/a.ts": encoder.encode("export const a = 'a';\n"),
		"shared/a.ts": encoder.encode("export const a = 'a';\n"),
		"backend/z.ts": encoder.encode("export const z = 'z';\n"),
		"backend/a.ts": encoder.encode("export const a = 'a';\n"),
		"client/b.tsx": encoder.encode("export const b = 'b';\n"),
		"client/c.css": encoder.encode(".fixture { color: red; }\n"),
	},
	manifest: {
		hooks: [],
		crons: [],
		scripts: [],
		providers: [],
		workflows: [],
		operations: [],
		savedViews: [],
		importSources: [],
		userBootstrap: [],
		signalSchemas: [],
		entitySchemas: [],
		httpRateLimits: [],
		relationshipSchemas: [],
		integrationProviders: [],
		configSchema: { fields: {}, unknownKeys: "strict" },
		metadata: {
			icon: "fixture",
			name: "Fixture",
			slug: "fixture",
			version: "1.0.0",
			description: "Fixture",
		},
	},
} satisfies PluginArchivePackage;

const scriptEntry = "backend/main.sandbox.ts";
const scriptSource = 'export const manifest = "fixture";\n';
const scriptJavascript = 'const manifest = "fixture";\n';
const scriptManifest: PluginArchivePackage["manifest"] = {
	...fixture.manifest,
	scripts: [
		{
			kind: "script",
			slug: "fixture",
			capabilities: [],
			entry: scriptEntry,
			name: "Fixture script",
			requiredPluginConfigKeys: [],
		},
	],
};
const compiledScriptFixture = {
	format: 1,
	entry: scriptEntry,
	source: scriptSource,
	javascript: scriptJavascript,
};
const scriptFixture: PluginArchivePackage = {
	...fixture,
	manifest: scriptManifest,
	compiledScripts: [compiledScriptFixture],
	files: { ...fixture.files, [scriptEntry]: encoder.encode(scriptSource) },
};

const compiledClientFixture: PluginClientArtifact = {
	hash: "artifact-hash",
	format: CLIENT_ARTIFACT_FORMAT,
	apiVersion: CLIENT_API_VERSION,
	compilerVersion: CLIENT_COMPILER_VERSION,
	bridgeVersion: CLIENT_BRIDGE_PROTOCOL_VERSION,
	files: [
		{
			name: "plugin.js",
			contentType: "text/javascript; charset=utf-8",
			contents: encoder.encode("export const plugin = true;\n"),
		},
		{
			name: "assets/icon.svg",
			contentType: "image/svg+xml",
			contents: new Uint8Array([0xff, 0x00, 0x7f]),
		},
		{
			name: "index.html",
			contentType: "text/html; charset=utf-8",
			contents: encoder.encode("<html></html>\n"),
		},
	],
};

const compiledClientMetadata = (artifact: PluginClientArtifact) =>
	encoder.encode(
		`${JSON.stringify(
			{
				hash: artifact.hash,
				format: artifact.format,
				apiVersion: artifact.apiVersion,
				bridgeVersion: artifact.bridgeVersion,
				compilerVersion: artifact.compilerVersion,
				files: artifact.files
					.map(({ name, contentType }) => ({ name, contentType }))
					.sort((left, right) => compareNames(left.name, right.name)),
			},
			null,
			"\t",
		)}\n`,
	);

const rawManifest = encoder.encode(`${JSON.stringify(fixture.manifest, null, "\t")}\n`);
const scriptRawManifest = encoder.encode(`${JSON.stringify(scriptManifest, null, "\t")}\n`);
const scriptJavascriptBytes = encoder.encode(scriptJavascript);
const scriptJavascriptHash = sha256Hex(scriptJavascriptBytes);
const scriptArchiveMetadata = encoder.encode(
	`${JSON.stringify(
		{ scripts: [{ format: 1, entry: scriptEntry, hash: scriptJavascriptHash }] },
		null,
		"\t",
	)}\n`,
);

const pathAtBytes = (bytes: number) =>
	`backend/${"a".repeat(bytes - encoder.encode("backend/.ts").byteLength)}.ts`;

const filesWithTotalBytes = (totalBytes: number) => {
	const files: Record<string, Uint8Array> = {};
	let remaining = totalBytes;
	let index = 0;
	while (remaining > 0) {
		const size = Math.min(remaining, PLUGIN_ARCHIVE_LIMITS.maxSourceBytes);
		files[`client/${index}.wasm`] = new Uint8Array(size);
		remaining -= size;
		index += 1;
	}
	return files;
};

const manifestWithBytes = (bytes: number): PluginArchivePackage["manifest"] => {
	const manifest = {
		...fixture.manifest,
		metadata: { ...fixture.manifest.metadata, description: "" },
	};
	const emptyBytes = encoder.encode(`${JSON.stringify(manifest, null, "\t")}\n`).byteLength;
	return {
		...manifest,
		metadata: { ...manifest.metadata, description: "a".repeat(bytes - emptyBytes) },
	};
};

const artifactFile = (artifact: PluginClientArtifact, name: string) => {
	const file = artifact.files.find((candidate) => candidate.name === name);
	if (file === undefined) {
		throw new Error(`Missing test artifact file: ${name}`);
	}
	return file;
};

const writeArchiveInTimezone = (timezone: string) => {
	const entry = new URL("./index.ts", import.meta.url).href;
	const serialized = JSON.stringify({
		manifest: fixture.manifest,
		compiledScripts: fixture.compiledScripts,
		files: Object.fromEntries(
			Object.entries(fixture.files).map(([path, bytes]) => [path, [...bytes]]),
		),
	});
	const script = `import { writePluginArchive } from ${JSON.stringify(entry)}; const value = ${serialized}; process.stdout.write(writePluginArchive({ manifest: value.manifest, files: Object.fromEntries(Object.entries(value.files).map(([path, bytes]) => [path, new Uint8Array(bytes)])), compiledScripts: value.compiledScripts }));`;
	const result = Bun.spawnSync([process.execPath, "--eval", script], {
		stderr: "pipe",
		stdout: "pipe",
		env: { ...process.env, TZ: timezone },
	});
	expect(new TextDecoder().decode(result.stderr)).toBe("");
	expect(result.exitCode).toBe(0);
	return result.stdout;
};

const archive = (entries: ReadonlyArray<readonly [string, Uint8Array]>) => {
	const chunks: Uint8Array[] = [];
	const zip = new Zip((error, chunk) => {
		if (error !== null) {
			throw new Error(error.message, { cause: error });
		} else {
			chunks.push(chunk.slice());
		}
	});
	for (const [path, bytes] of entries) {
		const file = new ZipDeflate(path, { level: 6 });
		zip.add(file);
		file.push(bytes, true);
	}
	zip.end();
	const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const output = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
};

const expectReason = (bytes: Uint8Array, reason: PluginArchiveErrorReason) =>
	Effect.runPromise(
		Effect.flip(readPluginArchive(bytes)).pipe(
			Effect.map((error) => {
				expect(error).toMatchObject({ reason });
			}),
		),
	);

const expectWriteReason = (
	pluginPackage: Parameters<typeof writePluginArchive>[0],
	reason: PluginArchiveErrorReason,
) => {
	let error: unknown;
	try {
		writePluginArchive(pluginPackage);
	} catch (caught) {
		error = caught;
	}
	expect(error).toMatchObject({ reason, _tag: "PluginArchiveError" });
};

const mutateHeaders = (
	input: Uint8Array,
	local: (view: DataView, offset: number) => void,
	central: (view: DataView, offset: number) => void,
) => {
	const bytes = input.slice();
	const view = new DataView(bytes.buffer);
	for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
		const signature = view.getUint32(offset, true);
		if (signature === 0x04034b50) {
			local(view, offset);
		}
		if (signature === 0x02014b50) {
			central(view, offset);
		}
	}
	return bytes;
};

describe("plugin archive", () => {
	it("writes byte-identical deterministic archives in canonical order", () => {
		const first = writePluginArchive(fixture);
		const second = writePluginArchive({
			manifest: fixture.manifest,
			files: Object.fromEntries(Object.entries(fixture.files).toReversed()),
		});
		expect(first).toEqual(second);
		const files = unzipSync(first);
		expect(Object.keys(files)).toEqual([
			"manifest.json",
			"backend/a.ts",
			"backend/z.ts",
			"shared/a.ts",
			"client/a.ts",
			"client/b.tsx",
			"client/c.css",
			"client/d.svg",
		]);
		expect(new TextDecoder().decode(files["manifest.json"])).toBe(
			`${JSON.stringify(fixture.manifest, null, "\t")}\n`,
		);
	});

	it.live("round trips deterministic compiled sandbox scripts and canonical metadata", () =>
		Effect.gen(function* () {
			const first = writePluginArchive(scriptFixture);
			const second = writePluginArchive({
				...scriptFixture,
				compiledScripts: scriptFixture.compiledScripts.toReversed(),
				files: Object.fromEntries(Object.entries(scriptFixture.files).toReversed()),
			});
			expect(first).toEqual(second);

			const entries = unzipSync(first);
			expect(Object.keys(entries)).toEqual([
				"manifest.json",
				"backend/a.ts",
				"backend/main.sandbox.ts",
				"backend/z.ts",
				"shared/a.ts",
				"client/a.ts",
				"client/b.tsx",
				"client/c.css",
				"client/d.svg",
				`compiled-backend/files/${scriptJavascriptHash}.js`,
				"compiled-backend/metadata.json",
			]);
			expect(entries[`compiled-backend/files/${scriptJavascriptHash}.js`]).toEqual(
				scriptJavascriptBytes,
			);
			expect(
				yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
					new TextDecoder().decode(entries["compiled-backend/metadata.json"]),
				),
			).toEqual({ scripts: [{ format: 1, entry: scriptEntry, hash: scriptJavascriptHash }] });

			const result = yield* readPluginArchive(first);
			expect(result.compiledScripts).toEqual(scriptFixture.compiledScripts);
		}),
	);

	it.live("keeps a compiled JavaScript BOM in the archive and decoded script", () =>
		Effect.gen(function* () {
			const javascript = `\ufeff${scriptJavascript}`;
			const bytes = encoder.encode(javascript);
			const result = writePluginArchive({
				...scriptFixture,
				compiledScripts: [{ ...compiledScriptFixture, javascript }],
			});
			expect(unzipSync(result)[`compiled-backend/files/${sha256Hex(bytes)}.js`]).toEqual(bytes);
			expect((yield* readPluginArchive(result)).compiledScripts[0]?.javascript).toBe(javascript);
		}),
	);

	it("rejects invalid UTF-8 in compiled JavaScript despite a matching byte hash", () => {
		const bytes = new Uint8Array([0xff]);
		const hash = sha256Hex(bytes);
		const metadata = encoder.encode(
			`${JSON.stringify({ scripts: [{ hash, format: 1, entry: scriptEntry }] })}\n`,
		);
		return expectReason(
			archive([
				["manifest.json", scriptRawManifest],
				[scriptEntry, encoder.encode(scriptSource)],
				["compiled-backend/metadata.json", metadata],
				[`compiled-backend/files/${hash}.js`, bytes],
			]),
			"compiled-script-invalid",
		);
	});

	it.live("requires every manifest script and rejects duplicate, extra, and missing outputs", () =>
		Effect.gen(function* () {
			expectWriteReason({ ...scriptFixture, compiledScripts: [] }, "compiled-script-invalid");
			expectWriteReason(
				{
					...scriptFixture,
					compiledScripts: [...scriptFixture.compiledScripts, ...scriptFixture.compiledScripts],
				},
				"compiled-script-invalid",
			);
			expectWriteReason(
				{
					...scriptFixture,
					compiledScripts: [{ ...compiledScriptFixture, entry: "backend/extra.sandbox.ts" }],
				},
				"compiled-script-invalid",
			);
			yield* Effect.promise(() =>
				expectReason(
					archive([
						["manifest.json", scriptRawManifest],
						[scriptEntry, encoder.encode(scriptSource)],
					]),
					"compiled-script-invalid",
				),
			);
		}),
	);

	it("rejects non-canonical entries, invalid UTF-8 JavaScript, and invalid formats", () => {
		expectWriteReason(
			{
				...scriptFixture,
				compiledScripts: [{ ...compiledScriptFixture, entry: "backend/../main.sandbox.ts" }],
			},
			"path-noncanonical",
		);
		expectWriteReason(
			{ ...scriptFixture, compiledScripts: [{ ...compiledScriptFixture, javascript: "\ud800" }] },
			"compiled-script-invalid",
		);
		expectWriteReason(
			{ ...scriptFixture, compiledScripts: [{ ...compiledScriptFixture, format: 1.5 }] },
			"compiled-script-invalid",
		);
	});

	it("rejects compiled JavaScript over its per-file bound", () =>
		expectWriteReason(
			{
				...scriptFixture,
				compiledScripts: [
					{
						...compiledScriptFixture,
						javascript: "a".repeat(PLUGIN_ARCHIVE_LIMITS.maxCompiledBackendJavascriptBytes + 1),
					},
				],
			},
			"compiled-script-bytes-exceeded",
		));

	it("rejects compiled script metadata whose JavaScript hash was tampered", () => {
		const tamperedJavascript = encoder.encode(scriptJavascript.replace("fixture", "tampered"));
		return expectReason(
			archive([
				["manifest.json", scriptRawManifest],
				[scriptEntry, encoder.encode(scriptSource)],
				["compiled-backend/metadata.json", scriptArchiveMetadata],
				[`compiled-backend/files/${scriptJavascriptHash}.js`, tamperedJavascript],
			]),
			"compiled-script-invalid",
		);
	});

	it.live("writes and reads deterministic compiled client entries with canonical metadata", () =>
		Effect.gen(function* () {
			const compiledClient = { ...compiledClientFixture, files: compiledClientFixture.files };
			const first = writePluginArchive({ ...fixture, compiledClient });
			const second = writePluginArchive({
				...fixture,
				files: Object.fromEntries(Object.entries(fixture.files).toReversed()),
				compiledClient: { ...compiledClient, files: compiledClient.files.toReversed() },
			});
			expect(first).toEqual(second);

			const entries = unzipSync(first);
			expect(Object.keys(entries)).toEqual([
				"manifest.json",
				"backend/a.ts",
				"backend/z.ts",
				"shared/a.ts",
				"client/a.ts",
				"client/b.tsx",
				"client/c.css",
				"client/d.svg",
				"compiled-client/files/assets/icon.svg",
				"compiled-client/files/index.html",
				"compiled-client/files/plugin.js",
				"compiled-client/metadata.json",
			]);
			expect(
				yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(
					new TextDecoder().decode(entries["compiled-client/metadata.json"]),
				),
			).toEqual({
				hash: compiledClient.hash,
				format: compiledClient.format,
				apiVersion: compiledClient.apiVersion,
				bridgeVersion: compiledClient.bridgeVersion,
				compilerVersion: compiledClient.compilerVersion,
				files: [
					{ name: "assets/icon.svg", contentType: "image/svg+xml" },
					{ name: "index.html", contentType: "text/html; charset=utf-8" },
					{ name: "plugin.js", contentType: "text/javascript; charset=utf-8" },
				],
			});
			expect(entries["compiled-client/files/assets/icon.svg"]).toEqual(
				new Uint8Array([0xff, 0x00, 0x7f]),
			);

			const result = yield* readPluginArchive(first);
			expect(result.compiledClient).toEqual({
				...compiledClient,
				files: compiledClient.files
					.slice()
					.sort((left, right) => compareNames(left.name, right.name)),
			});
		}),
	);

	it("writes byte-identical archives across timezones", () => {
		const utc = writeArchiveInTimezone("UTC");
		expect(writeArchiveInTimezone("America/Los_Angeles")).toEqual(utc);
		expect(writeArchiveInTimezone("Asia/Kolkata")).toEqual(utc);
	});

	it("orders paths by code units", () => {
		const bytes = writePluginArchive({
			manifest: fixture.manifest,
			files: {
				"backend/a.ts": new Uint8Array(0),
				"backend/B.ts": new Uint8Array(0),
				"backend/_x.ts": new Uint8Array(0),
			},
		});
		expect(Object.keys(unzipSync(bytes))).toEqual([
			"manifest.json",
			"backend/B.ts",
			"backend/_x.ts",
			"backend/a.ts",
		]);
	});

	it.live("round trips exact backend, shared, client text, and invalid UTF-8 asset bytes", () =>
		Effect.gen(function* () {
			const pluginBytes = writePluginArchive(fixture);
			const chunks: AsyncIterable<Uint8Array> = {
				[Symbol.asyncIterator]() {
					let offset = 0;
					return {
						next: (): Promise<IteratorResult<Uint8Array>> => {
							if (offset >= pluginBytes.byteLength) {
								return Promise.resolve(
									Object.assign({ done: true as const }, { value: undefined }),
								);
							}
							const value = pluginBytes.subarray(offset, offset + 7);
							offset += 7;
							return Promise.resolve(Object.assign({ done: false as const }, { value }));
						},
					};
				},
			};
			const result = yield* readPluginArchive(chunks);
			expect(result.manifest).toEqual(fixture.manifest);
			for (const [path, bytes] of Object.entries(fixture.files)) {
				expect(result.files[path]).toEqual(bytes);
			}
		}),
	);

	it("maps a failed external async iterable to the archive error", () => {
		let first = true;
		const input: AsyncIterable<Uint8Array> = {
			// The input models a Promise-based transport failing after its first chunk.
			[Symbol.asyncIterator]() {
				return {
					next: (): Promise<IteratorResult<Uint8Array>> => {
						if (first) {
							first = false;
							return Promise.resolve({ done: false, value: rawManifest });
						}
						return Promise.reject(new Error("transport closed"));
					},
				};
			},
		};
		return Effect.runPromise(
			Effect.gen(function* () {
				const error = yield* Effect.flip(readPluginArchive(input));
				expect(error.reason).toBe("malformed-zip");
			}),
		);
	});

	it.live(
		"returns a boundary archive accepted by its reader",
		() =>
			Effect.gen(function* () {
				const path = pathAtBytes(PLUGIN_ARCHIVE_LIMITS.maxPathBytes);
				const bytes = new Uint8Array(PLUGIN_ARCHIVE_LIMITS.maxSourceBytes);
				const pluginBytes = writePluginArchive({
					files: { [path]: bytes },
					manifest: fixture.manifest,
				});
				const result = yield* readPluginArchive(pluginBytes);

				expect(result.files[path]).toEqual(bytes);
			}),
		20_000,
	);

	it("rejects one entry over the writer file-count limit", () => {
		const files: Record<string, Uint8Array> = {};
		for (let index = 0; index < PLUGIN_ARCHIVE_LIMITS.maxEntryCount; index += 1) {
			files[`backend/${index}.ts`] = new Uint8Array(0);
		}
		expectWriteReason({ files, manifest: fixture.manifest }, "entry-count-exceeded");
	});

	it("rejects a writer path one byte over the limit", () =>
		expectWriteReason(
			{
				manifest: fixture.manifest,
				files: { [pathAtBytes(PLUGIN_ARCHIVE_LIMITS.maxPathBytes + 1)]: new Uint8Array(0) },
			},
			"path-bytes-exceeded",
		));

	it("rejects a writer manifest one byte over the limit", () =>
		expectWriteReason(
			{ files: {}, manifest: manifestWithBytes(PLUGIN_ARCHIVE_LIMITS.maxManifestBytes + 1) },
			"manifest-bytes-exceeded",
		));

	it("rejects a writer source one byte over the limit", () =>
		expectWriteReason(
			{
				manifest: fixture.manifest,
				files: { "client/source.wasm": new Uint8Array(PLUGIN_ARCHIVE_LIMITS.maxSourceBytes + 1) },
			},
			"source-bytes-exceeded",
		));

	it("rejects writer input one byte over the total uncompressed limit", () =>
		expectWriteReason(
			{
				manifest: fixture.manifest,
				files: filesWithTotalBytes(
					PLUGIN_ARCHIVE_LIMITS.maxTotalUncompressedBytes - rawManifest.byteLength + 1,
				),
			},
			"total-uncompressed-bytes-exceeded",
		));

	it.each([
		["source-non-utf8", { "backend/a.ts": new Uint8Array([0xff]) }],
		["path-noncanonical", { "backend\\a.ts": new Uint8Array(0) }],
		["duplicate-manifest", { "manifest.json": rawManifest }],
	] as const)("rejects writer input with %s", (reason, files) =>
		expectWriteReason({ files, manifest: fixture.manifest }, reason),
	);

	it.live.each([
		"backend/data.json",
		"backend/ignored.test.ts",
		"shared/unsupported.tsx",
		"shared/ignored.test.ts",
		"client/unsupported.js",
		"client/ignored.test.tsx",
	])("rejects unsupported source path %s in the writer and reader", (path) =>
		Effect.gen(function* () {
			expectWriteReason(
				{ manifest: fixture.manifest, files: { [path]: new Uint8Array(0) } },
				"unexpected-entry",
			);
			yield* Effect.promise(() =>
				expectReason(
					archive([
						["manifest.json", rawManifest],
						[path, new Uint8Array(0)],
					]),
					"unexpected-entry",
				),
			);
		}),
	);

	it.live("rejects a compiled client with a non-canonical file path", () =>
		Effect.gen(function* () {
			const file = artifactFile(compiledClientFixture, "plugin.js");
			const compiledClient = {
				...compiledClientFixture,
				files: [{ ...file, name: "../plugin.js" }],
			};
			expectWriteReason({ ...fixture, compiledClient }, "path-noncanonical");
			yield* Effect.promise(() =>
				expectReason(
					archive([
						["manifest.json", rawManifest],
						["compiled-client/metadata.json", compiledClientMetadata(compiledClient)],
						["compiled-client/files/../plugin.js", file.contents],
					]),
					"path-noncanonical",
				),
			);
		}),
	);

	it.live("rejects compiled client bytes over the artifact limit in the writer and reader", () =>
		Effect.gen(function* () {
			const contents = new Uint8Array(PLUGIN_ARCHIVE_LIMITS.maxCompiledClientBytes + 1);
			const file = { contents, name: "index.html", contentType: "text/html; charset=utf-8" };
			const compiledClient = { ...compiledClientFixture, files: [file] };
			expectWriteReason({ ...fixture, compiledClient }, "compiled-client-bytes-exceeded");
			yield* Effect.promise(() =>
				expectReason(
					archive([
						["manifest.json", rawManifest],
						["compiled-client/metadata.json", compiledClientMetadata(compiledClient)],
						["compiled-client/files/index.html", contents],
					]),
					"compiled-client-bytes-exceeded",
				),
			);
		}),
	);

	it.live(
		"rejects compiled client file counts over the artifact limit in the writer and reader",
		() =>
			Effect.gen(function* () {
				const files = Array.from(
					{ length: PLUGIN_ARCHIVE_LIMITS.maxCompiledClientFiles + 1 },
					(_, index) => ({
						name: `assets/${index}.js`,
						contents: new Uint8Array(0),
						contentType: "text/javascript; charset=utf-8",
					}),
				);
				const compiledClient = { ...compiledClientFixture, files };
				expectWriteReason({ ...fixture, compiledClient }, "compiled-client-file-count-exceeded");
				yield* Effect.promise(() =>
					expectReason(
						archive([
							["manifest.json", rawManifest],
							["compiled-client/metadata.json", compiledClientMetadata(compiledClient)],
							...files.map(
								({ name, contents }) => [`compiled-client/files/${name}`, contents] as const,
							),
						]),
						"compiled-client-file-count-exceeded",
					),
				);
			}),
	);

	it.live("rejects incomplete and malformed compiled client metadata", () =>
		Effect.gen(function* () {
			yield* Effect.promise(() =>
				expectReason(
					archive([
						["manifest.json", rawManifest],
						["compiled-client/metadata.json", compiledClientMetadata(compiledClientFixture)],
						[
							"compiled-client/files/index.html",
							artifactFile(compiledClientFixture, "index.html").contents,
						],
					]),
					"compiled-client-invalid",
				),
			);
			yield* Effect.promise(() =>
				expectReason(
					archive([
						["manifest.json", rawManifest],
						["compiled-client/metadata.json", encoder.encode('{"format":"wrong"}')],
					]),
					"compiled-client-invalid",
				),
			);
		}),
	);

	it.live("rejects unsupported compiled client output content types", () =>
		Effect.gen(function* () {
			const originalFile = artifactFile(compiledClientFixture, "plugin.js");
			const file = {
				name: originalFile.name,
				contents: originalFile.contents,
				contentType: "application/json",
			};
			const compiledClient = { ...compiledClientFixture, files: [file] };
			expectWriteReason({ ...fixture, compiledClient }, "compiled-client-invalid");
			yield* Effect.promise(() =>
				expectReason(
					archive([
						["manifest.json", rawManifest],
						["compiled-client/metadata.json", compiledClientMetadata(compiledClient)],
						["compiled-client/files/plugin.js", file.contents],
					]),
					"compiled-client-invalid",
				),
			);
		}),
	);

	it.live("rejects invalid UTF-8 compiled client JavaScript in writer and reader", () =>
		Effect.gen(function* () {
			const file = {
				...artifactFile(compiledClientFixture, "plugin.js"),
				contents: new Uint8Array([0xff]),
			};
			const compiledClient = { ...compiledClientFixture, files: [file] };
			expectWriteReason({ ...fixture, compiledClient }, "compiled-client-invalid");
			yield* Effect.promise(() =>
				expectReason(
					archive([
						["manifest.json", rawManifest],
						["compiled-client/metadata.json", compiledClientMetadata(compiledClient)],
						["compiled-client/files/plugin.js", file.contents],
					]),
					"compiled-client-invalid",
				),
			);
		}),
	);

	it("rejects the compressed byte limit", () =>
		expectReason(
			new Uint8Array(PLUGIN_ARCHIVE_LIMITS.maxCompressedBytes + 1),
			"compressed-bytes-exceeded",
		));

	it("rejects the entry count limit", () => {
		const entries: Array<readonly [string, Uint8Array]> = [["manifest.json", rawManifest]];
		for (let index = 0; index < PLUGIN_ARCHIVE_LIMITS.maxEntryCount; index += 1) {
			entries.push([`backend/${index}.ts`, new Uint8Array(0)]);
		}
		return expectReason(archive(entries), "entry-count-exceeded");
	});

	it("rejects the path byte limit", () =>
		expectReason(
			archive([
				["manifest.json", rawManifest],
				[pathAtBytes(PLUGIN_ARCHIVE_LIMITS.maxPathBytes + 1), new Uint8Array(0)],
			]),
			"path-bytes-exceeded",
		));

	it("rejects the manifest byte limit", () =>
		expectReason(
			archive([["manifest.json", new Uint8Array(PLUGIN_ARCHIVE_LIMITS.maxManifestBytes + 1)]]),
			"manifest-bytes-exceeded",
		));

	it("rejects the source byte limit", () =>
		expectReason(
			archive([
				["manifest.json", rawManifest],
				["backend/a.ts", new Uint8Array(PLUGIN_ARCHIVE_LIMITS.maxSourceBytes + 1)],
			]),
			"source-bytes-exceeded",
		));

	it("rejects the total uncompressed byte limit", () => {
		const entries: Array<readonly [string, Uint8Array]> = [
			["manifest.json", rawManifest],
			...Object.entries(
				filesWithTotalBytes(
					PLUGIN_ARCHIVE_LIMITS.maxTotalUncompressedBytes - rawManifest.byteLength + 1,
				),
			),
		];
		return expectReason(archive(entries), "total-uncompressed-bytes-exceeded");
	}, 20_000);

	it.each([
		[
			"directory-entry",
			[
				["manifest.json", rawManifest],
				["backend/", new Uint8Array(0)],
			],
		],
		[
			"unexpected-entry",
			[
				["manifest.json", rawManifest],
				["frontend/a.ts", new Uint8Array(0)],
			],
		],
		[
			"unexpected-entry",
			[
				["manifest.json", rawManifest],
				["client/a.js", new Uint8Array(0)],
			],
		],
		[
			"unexpected-entry",
			[
				["manifest.json", rawManifest],
				["shared/a.tsx", new Uint8Array(0)],
			],
		],
		[
			"unexpected-entry",
			[
				["manifest.json", rawManifest],
				["shared/a.css", new Uint8Array(0)],
			],
		],
		[
			"path-noncanonical",
			[
				["manifest.json", rawManifest],
				["backend\\a.ts", new Uint8Array(0)],
			],
		],
		["missing-manifest", [["backend/a.ts", new Uint8Array(0)]]],
		["manifest-invalid", [["manifest.json", encoder.encode("{}")]]],
		[
			"source-non-utf8",
			[
				["manifest.json", rawManifest],
				["backend/a.ts", new Uint8Array([0xff])],
			],
		],
		[
			"source-non-utf8",
			[
				["manifest.json", rawManifest],
				["client/a.css", new Uint8Array([0xff])],
			],
		],
		[
			"source-non-utf8",
			[
				["manifest.json", rawManifest],
				["shared/a.ts", new Uint8Array([0xff])],
			],
		],
	] as const)("rejects %s", (reason, entries) => expectReason(archive(entries), reason));

	it("rejects duplicate source entries", () =>
		expectReason(
			archive([
				["manifest.json", rawManifest],
				["backend/a.ts", new Uint8Array(0)],
				["backend/a.ts", new Uint8Array(0)],
			]),
			"duplicate-entry",
		));

	it("rejects duplicate manifests", () =>
		expectReason(
			archive([
				["manifest.json", rawManifest],
				["manifest.json", rawManifest],
			]),
			"duplicate-manifest",
		));

	it("rejects non-UTF-8 paths", () => {
		const bytes = mutateHeaders(
			archive([["manifest.json", rawManifest]]),
			(view, offset) => view.setUint8(offset + 30, 0xff),
			(view, offset) => view.setUint8(offset + 46, 0xff),
		);
		return expectReason(bytes, "path-non-utf8");
	});

	it("rejects encrypted entries", () => {
		const bytes = mutateHeaders(
			archive([["manifest.json", rawManifest]]),
			(view, offset) => view.setUint16(offset + 6, view.getUint16(offset + 6, true) | 1, true),
			(view, offset) => view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 1, true),
		);
		return expectReason(bytes, "encrypted-entry");
	});

	it("rejects unsupported compression", () => {
		const bytes = mutateHeaders(
			archive([["manifest.json", rawManifest]]),
			(view, offset) => view.setUint16(offset + 8, 12, true),
			(view, offset) => view.setUint16(offset + 10, 12, true),
		);
		return expectReason(bytes, "unsupported-compression");
	});

	it("rejects malformed ZIP data", () =>
		expectReason(zipSync({ "manifest.json": rawManifest }).subarray(0, 20), "malformed-zip"));
});
