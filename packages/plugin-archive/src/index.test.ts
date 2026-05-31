import type { PluginPackage } from "@ryot/contract/modules/plugins/schemas";
import { Effect } from "effect";
import { unzipSync, Zip, zipSync, ZipDeflate } from "fflate";
import { describe, expect, it } from "vitest";

import type { PluginArchiveErrorReason } from "./index";
import { PLUGIN_ARCHIVE_LIMITS, readPluginArchive, writePluginArchive } from "./index";

const encoder = new TextEncoder();

const fixture = {
	files: {
		"backend/z.ts": "export const z = 'z';\n",
		"backend/a.ts": "export const a = 'a';\n",
		"client/a.ts": "export const a = 'a';\n",
		"client/b.tsx": "export const b = 'b';\n",
		"client/c.css": ".fixture { color: red; }\n",
		"client/d.svg": "<svg />\n",
	},
	manifest: {
		boot: [],
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
		bindings: {
			eventAutomations: [],
			entityAutomations: [],
			signalAutomations: [],
			relationshipAutomations: [],
			providerEntityImportAutomations: [],
		},
	},
} satisfies PluginPackage;

const rawManifest = encoder.encode(`${JSON.stringify(fixture.manifest, null, "\t")}\n`);

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

const expectReason = async (bytes: Uint8Array, reason: PluginArchiveErrorReason) => {
	expect(await Effect.runPromise(Effect.flip(readPluginArchive(bytes)))).toMatchObject({ reason });
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
			"client/a.ts",
			"client/b.tsx",
			"client/c.css",
			"client/d.svg",
		]);
		expect(new TextDecoder().decode(files["manifest.json"])).toBe(
			`${JSON.stringify(fixture.manifest, null, "\t")}\n`,
		);
	});

	it("round trips backend and client sources from an async byte stream", async () => {
		const bytes = writePluginArchive(fixture);
		async function* chunks() {
			await Promise.resolve();
			for (let offset = 0; offset < bytes.byteLength; offset += 7) {
				yield bytes.subarray(offset, offset + 7);
			}
		}
		expect(await Effect.runPromise(readPluginArchive(chunks()))).toEqual(fixture);
	});

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
				[`backend/${"a".repeat(PLUGIN_ARCHIVE_LIMITS.maxPathBytes)}.ts`, new Uint8Array(0)],
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
		const entries: Array<readonly [string, Uint8Array]> = [["manifest.json", rawManifest]];
		for (let index = 0; index < 65; index += 1) {
			entries.push([`backend/${index}.ts`, new Uint8Array(PLUGIN_ARCHIVE_LIMITS.maxSourceBytes)]);
		}
		return expectReason(archive(entries), "total-uncompressed-bytes-exceeded");
	});

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
