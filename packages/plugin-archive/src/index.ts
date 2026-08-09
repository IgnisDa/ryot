import {
	isPluginClientTextSource,
	pluginClientFileExtension,
} from "@ryot-app/contract/modules/plugins/client";
import { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { Effect, Schema, Stream } from "effect";
import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipDeflate } from "fflate";

export const PLUGIN_ARCHIVE_LIMITS = {
	maxPathBytes: 256,
	maxEntryCount: 1024,
	maxSourceBytes: 256 * 1024,
	maxManifestBytes: 4 * 1024 * 1024,
	maxCompressedBytes: 8 * 1024 * 1024,
	maxTotalUncompressedBytes: 16 * 1024 * 1024,
} as const;

export const PluginArchiveErrorReason = Schema.Literals([
	"compressed-bytes-exceeded",
	"directory-entry",
	"duplicate-entry",
	"duplicate-manifest",
	"encrypted-entry",
	"entry-count-exceeded",
	"manifest-bytes-exceeded",
	"manifest-invalid",
	"malformed-zip",
	"missing-manifest",
	"path-bytes-exceeded",
	"path-non-utf8",
	"path-noncanonical",
	"source-bytes-exceeded",
	"source-non-utf8",
	"total-uncompressed-bytes-exceeded",
	"unexpected-entry",
	"unsupported-compression",
]);

export type PluginArchiveErrorReason = typeof PluginArchiveErrorReason.Type;

export class PluginArchiveError extends Schema.TaggedError<PluginArchiveError>()(
	"PluginArchiveError",
	{ reason: PluginArchiveErrorReason },
) {}

export type PluginArchivePackage = {
	readonly manifest: typeof PluginManifest.Type;
	readonly files: Readonly<Record<string, Uint8Array>>;
};

const DETERMINISTIC_MTIME = new Date(1980, 0, 1, 0, 0, 0, 0);
const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

const compareCodeUnits = (left: string, right: string) => {
	if (left < right) {
		return -1;
	}
	if (left > right) {
		return 1;
	}
	return 0;
};

const failure = (reason: PluginArchiveErrorReason) => new PluginArchiveError({ reason });

const concat = (chunks: ReadonlyArray<Uint8Array>, size?: number) => {
	const output = new Uint8Array(
		size ?? chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
	);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
};

export const writePluginArchive = (pluginPackage: PluginArchivePackage) => {
	const output: Uint8Array[] = [];
	const zip = new Zip((error, chunk) => {
		if (error !== null) {
			throw new Error(error.message, { cause: error });
		} else if (chunk.byteLength > 0) {
			output.push(chunk.slice());
		}
	});
	const entries: Array<readonly [string, Uint8Array]> = [
		["manifest.json", encoder.encode(`${JSON.stringify(pluginPackage.manifest, null, "\t")}\n`)],
		...Object.entries(pluginPackage.files).sort(([left], [right]) => compareCodeUnits(left, right)),
	];
	for (const [path, bytes] of entries) {
		const file = new ZipDeflate(path, { level: 6 });
		file.mtime = DETERMINISTIC_MTIME;
		file.os = 0;
		zip.add(file);
		file.push(bytes, true);
	}
	zip.end();
	return concat(output);
};

type ExtractedEntry = {
	readonly chunks: Uint8Array[];
	bytes: number;
};

const readUint16 = (view: DataView, offset: number) => view.getUint16(offset, true);
const readUint32 = (view: DataView, offset: number) => view.getUint32(offset, true);

const validateCentralDirectory = (bytes: Uint8Array) => {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let eocd = bytes.byteLength - 22;
	const earliest = Math.max(0, bytes.byteLength - 65_557);
	while (eocd >= earliest && readUint32(view, eocd) !== 0x06054b50) {
		eocd -= 1;
	}
	if (eocd < earliest || eocd + 22 + readUint16(view, eocd + 20) !== bytes.byteLength) {
		throw failure("malformed-zip");
	}
	const entryCount = readUint16(view, eocd + 10);
	if (entryCount > PLUGIN_ARCHIVE_LIMITS.maxEntryCount) {
		throw failure("entry-count-exceeded");
	}
	if (
		readUint16(view, eocd + 8) !== entryCount ||
		readUint16(view, eocd + 4) !== 0 ||
		readUint16(view, eocd + 6) !== 0
	) {
		throw failure("malformed-zip");
	}
	const centralSize = readUint32(view, eocd + 12);
	const centralOffset = readUint32(view, eocd + 16);
	if (centralOffset + centralSize !== eocd) {
		throw failure("malformed-zip");
	}
	const paths = new Set<string>();
	let manifestCount = 0;
	let offset = centralOffset;
	for (let index = 0; index < entryCount; index += 1) {
		if (offset + 46 > eocd || readUint32(view, offset) !== 0x02014b50) {
			throw failure("malformed-zip");
		}
		const flags = readUint16(view, offset + 8);
		const compression = readUint16(view, offset + 10);
		const pathBytes = readUint16(view, offset + 28);
		const extraBytes = readUint16(view, offset + 30);
		const commentBytes = readUint16(view, offset + 32);
		const externalAttributes = readUint32(view, offset + 38);
		const localOffset = readUint32(view, offset + 42);
		const end = offset + 46 + pathBytes + extraBytes + commentBytes;
		if (
			end > eocd ||
			localOffset + 30 > centralOffset ||
			readUint32(view, localOffset) !== 0x04034b50
		) {
			throw failure("malformed-zip");
		}
		const localFlags = readUint16(view, localOffset + 6);
		const localCompression = readUint16(view, localOffset + 8);
		const localPathBytes = readUint16(view, localOffset + 26);
		const localExtraBytes = readUint16(view, localOffset + 28);
		const localPathOffset = localOffset + 30;
		if (
			pathBytes > PLUGIN_ARCHIVE_LIMITS.maxPathBytes ||
			localPathBytes > PLUGIN_ARCHIVE_LIMITS.maxPathBytes
		) {
			throw failure("path-bytes-exceeded");
		}
		if (localPathOffset + localPathBytes + localExtraBytes > centralOffset) {
			throw failure("malformed-zip");
		}
		if ((flags & 1) !== 0 || (localFlags & 1) !== 0) {
			throw failure("encrypted-entry");
		}
		if (
			(compression !== 0 && compression !== 8) ||
			(localCompression !== 0 && localCompression !== 8)
		) {
			throw failure("unsupported-compression");
		}
		if (flags !== localFlags || compression !== localCompression) {
			throw failure("malformed-zip");
		}
		let path: string;
		let localPath: string;
		try {
			path = decoder.decode(bytes.subarray(offset + 46, offset + 46 + pathBytes));
			localPath = decoder.decode(bytes.subarray(localPathOffset, localPathOffset + localPathBytes));
		} catch {
			throw failure("path-non-utf8");
		}
		if (path !== localPath) {
			throw failure("malformed-zip");
		}
		const unixFileType = (externalAttributes >>> 16) & 0xf000;
		if (
			path.endsWith("/") ||
			path.endsWith("\\") ||
			(externalAttributes & 0x10) !== 0 ||
			unixFileType === 0x4000
		) {
			throw failure("directory-entry");
		}
		if (canonicalRelativePosixPathIssue(path) !== null) {
			throw failure("path-noncanonical");
		}
		if (
			path !== "manifest.json" &&
			!path.startsWith("backend/") &&
			(!path.startsWith("client/") || pluginClientFileExtension(path) === undefined)
		) {
			throw failure("unexpected-entry");
		}
		if (paths.has(path)) {
			throw failure(path === "manifest.json" ? "duplicate-manifest" : "duplicate-entry");
		}
		paths.add(path);
		if (path === "manifest.json") {
			manifestCount += 1;
		}
		offset = end;
	}
	if (offset !== eocd) {
		throw failure("malformed-zip");
	}
	if (manifestCount === 0) {
		throw failure("missing-manifest");
	}
	return paths;
};

class PluginArchiveReader {
	readonly #archive: Uint8Array[] = [];
	readonly #entries = new Map<string, ExtractedEntry>();
	#archiveBytes = 0;
	#entryCount = 0;
	#totalBytes = 0;
	#unzipFailure: unknown = null;
	#failure: PluginArchiveError | null = null;
	readonly #unzip = new Unzip((file) => {
		this.#entryCount += 1;
		if (this.#entryCount > PLUGIN_ARCHIVE_LIMITS.maxEntryCount) {
			this.#failure = failure("entry-count-exceeded");
			return;
		}
		const entry: ExtractedEntry = { bytes: 0, chunks: [] };
		this.#entries.set(file.name, entry);
		file.ondata = (error, data) => {
			if (this.#failure !== null) {
				return;
			}
			if (error !== null) {
				this.#unzipFailure = error;
				return;
			}
			entry.bytes += data.byteLength;
			this.#totalBytes += data.byteLength;
			const entryLimit =
				file.name === "manifest.json"
					? PLUGIN_ARCHIVE_LIMITS.maxManifestBytes
					: PLUGIN_ARCHIVE_LIMITS.maxSourceBytes;
			if (entry.bytes > entryLimit) {
				this.#failure = failure(
					file.name === "manifest.json" ? "manifest-bytes-exceeded" : "source-bytes-exceeded",
				);
				file.terminate();
				return;
			}
			if (this.#totalBytes > PLUGIN_ARCHIVE_LIMITS.maxTotalUncompressedBytes) {
				this.#failure = failure("total-uncompressed-bytes-exceeded");
				file.terminate();
				return;
			}
			entry.chunks.push(data.slice());
		};
		file.start();
	});

	constructor() {
		this.#unzip.register(UnzipPassThrough);
		this.#unzip.register(UnzipInflate);
	}

	push(chunk: Uint8Array, final: boolean) {
		this.#archiveBytes += chunk.byteLength;
		if (this.#archiveBytes > PLUGIN_ARCHIVE_LIMITS.maxCompressedBytes) {
			throw failure("compressed-bytes-exceeded");
		}
		this.#archive.push(chunk.slice());
		if (this.#unzipFailure === null) {
			try {
				this.#unzip.push(chunk, final);
			} catch (error) {
				this.#unzipFailure = error;
			}
		}
		if (this.#failure !== null) {
			throw this.#failure;
		}
	}

	finish() {
		const archive = concat(this.#archive, this.#archiveBytes);
		const paths = validateCentralDirectory(archive);
		if (this.#unzipFailure !== null) {
			throw failure("malformed-zip");
		}
		if (
			this.#entryCount !== paths.size ||
			this.#entries.size !== paths.size ||
			[...paths].some((path) => !this.#entries.has(path))
		) {
			throw failure("malformed-zip");
		}
		const manifestEntry = this.#entries.get("manifest.json");
		if (manifestEntry === undefined) {
			throw failure("missing-manifest");
		}
		let manifest: PluginArchivePackage["manifest"];
		try {
			const text = decoder.decode(concat(manifestEntry.chunks, manifestEntry.bytes));
			manifest = Schema.decodeUnknownSync(PluginManifest)(JSON.parse(text));
		} catch {
			throw failure("manifest-invalid");
		}
		const files: Record<string, Uint8Array> = {};
		for (const [path, entry] of this.#entries) {
			if (path === "manifest.json") {
				continue;
			}
			const bytes = concat(entry.chunks, entry.bytes);
			if (path.startsWith("backend/") || isPluginClientTextSource(path)) {
				try {
					decoder.decode(bytes);
				} catch {
					throw failure("source-non-utf8");
				}
			}
			files[path] = bytes;
		}
		return { files, manifest } satisfies PluginArchivePackage;
	}
}

const normalizeError = (error: unknown) =>
	error instanceof PluginArchiveError ? error : failure("malformed-zip");

export const readPluginArchive = (
	input: Uint8Array | AsyncIterable<Uint8Array>,
): Effect.Effect<PluginArchivePackage, PluginArchiveError> =>
	Effect.tryPromise({
		try: async () => {
			const reader = new PluginArchiveReader();
			if (input instanceof Uint8Array) {
				reader.push(input, true);
			} else {
				for await (const chunk of input) {
					reader.push(chunk, false);
				}
				reader.push(new Uint8Array(0), true);
			}
			return reader.finish();
		},
		catch: normalizeError,
	});

export const readPluginArchiveStream = <E>(
	input: Stream.Stream<Uint8Array, E>,
): Effect.Effect<PluginArchivePackage, E | PluginArchiveError> =>
	Effect.gen(function* () {
		const reader = new PluginArchiveReader();
		yield* Stream.runForEach(input, (chunk) =>
			Effect.try({
				try: () => reader.push(chunk, false),
				catch: normalizeError,
			}),
		);
		yield* Effect.try({
			try: () => reader.push(new Uint8Array(0), true),
			catch: normalizeError,
		});
		return yield* Effect.try({ try: () => reader.finish(), catch: normalizeError });
	});
