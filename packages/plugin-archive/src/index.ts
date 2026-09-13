import { createHash } from "node:crypto";

import {
	PluginClientArtifact,
	PluginClientArtifactMetadata,
	isPluginClientArtifactContentType,
	isPluginClientTextSource,
	isPluginSourceFile,
	type PluginClientArtifact as PluginClientArtifactType,
} from "@ryot-app/client-plugin-contract";
import { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { isPluginSharedSource } from "@ryot-app/contract/modules/plugins/shared-file-policy";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { canonicalRelativePosixPathIssue } from "@ryot-app/ts-utils/path";
import { Effect, Schema, Stream } from "effect";
import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipDeflate } from "fflate";

export const PLUGIN_ARCHIVE_LIMITS = {
	maxPathBytes: 256,
	maxEntryCount: 1024,
	maxSourceBytes: 256 * 1024,
	maxCompiledClientFiles: 128,
	maxManifestBytes: 4 * 1024 * 1024,
	maxCompressedBytes: 32 * 1024 * 1024,
	maxCompiledClientBytes: 8 * 1024 * 1024,
	maxCompiledBackendBytes: 32 * 1024 * 1024,
	maxCompiledClientMetadataBytes: 256 * 1024,
	maxCompiledBackendMetadataBytes: 256 * 1024,
	maxCompiledBackendJavascriptBytes: 1024 * 1024,
	maxTotalUncompressedBytes: 16 * 1024 * 1024 + 8 * 1024 * 1024 + 32 * 1024 * 1024 + 512 * 1024,
} as const;

export const PluginArchiveErrorReason = Schema.Literals([
	"compressed-bytes-exceeded",
	"compiled-client-bytes-exceeded",
	"compiled-client-file-count-exceeded",
	"compiled-client-invalid",
	"compiled-client-metadata-bytes-exceeded",
	"compiled-script-bytes-exceeded",
	"compiled-script-invalid",
	"compiled-script-metadata-bytes-exceeded",
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

export type PluginArchiveCompiledScript = {
	readonly entry: string;
	readonly source: string;
	readonly javascript: string;
	readonly format: number;
};

export type PluginArchivePackage = {
	readonly manifest: typeof PluginManifest.Type;
	readonly files: Readonly<Record<string, Uint8Array>>;
	readonly compiledScripts: ReadonlyArray<PluginArchiveCompiledScript>;
	readonly compiledClient?: PluginClientArtifactType;
};

type PluginArchiveInput = Omit<PluginArchivePackage, "compiledScripts"> & {
	readonly compiledScripts?: ReadonlyArray<PluginArchiveCompiledScript>;
};

const compiledBackendMetadataPath = "compiled-backend/metadata.json";
const compiledBackendFilePrefix = "compiled-backend/files/";
const compiledClientMetadataPath = "compiled-client/metadata.json";
const compiledClientFilePrefix = "compiled-client/files/";

const PluginArchiveCompiledScriptMetadataEntry = strictStruct({
	hash: Schema.String,
	entry: Schema.String,
	format: Schema.Number,
});

const PluginArchiveCompiledScriptsMetadata = strictStruct({
	scripts: Schema.Array(PluginArchiveCompiledScriptMetadataEntry),
});

const PluginClientArtifactArchiveFileMetadata = strictStruct({
	name: Schema.String,
	contentType: Schema.String,
});

const PluginClientArtifactArchiveMetadata = strictStruct({
	...PluginClientArtifactMetadata.fields,
	files: Schema.Array(PluginClientArtifactArchiveFileMetadata),
});

const DETERMINISTIC_MTIME = new Date(1980, 0, 1, 0, 0, 0, 0);
const decoder = new TextDecoder("utf-8", { fatal: true });
const compiledScriptDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
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

const bytesEqual = (left: Uint8Array, right: Uint8Array) =>
	left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);

const sourcePathRank = (path: string) => {
	if (path.startsWith("backend/")) {
		return 0;
	}
	if (path.startsWith("shared/")) {
		return 1;
	}
	if (path.startsWith("client/")) {
		return 2;
	}
	return 3;
};

const failure = (reason: PluginArchiveErrorReason) => new PluginArchiveError({ reason });

const normalizeError = (error: unknown) =>
	error instanceof PluginArchiveError ? error : failure("malformed-zip");

const validateCompressedBytes = (bytes: number) => {
	if (bytes > PLUGIN_ARCHIVE_LIMITS.maxCompressedBytes) {
		throw failure("compressed-bytes-exceeded");
	}
};

const validateEntryCount = (entries: number) => {
	if (entries > PLUGIN_ARCHIVE_LIMITS.maxEntryCount) {
		throw failure("entry-count-exceeded");
	}
};

const validatePathBytes = (bytes: number) => {
	if (bytes > PLUGIN_ARCHIVE_LIMITS.maxPathBytes) {
		throw failure("path-bytes-exceeded");
	}
};

const isCompiledClientFilePath = (path: string) => path.startsWith(compiledClientFilePrefix);
const isCompiledBackendFilePath = (path: string) => path.startsWith(compiledBackendFilePrefix);

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

const validateCompiledScriptEntry = (entry: string) => {
	if (canonicalRelativePosixPathIssue(entry) !== null) {
		throw failure("path-noncanonical");
	}
	if (
		(!entry.startsWith("backend/") && !entry.startsWith("shared/")) ||
		!isPluginSourceFile(entry) ||
		!entry.endsWith(".sandbox.ts")
	) {
		throw failure("compiled-script-invalid");
	}
	const entryBytes = encoder.encode(entry);
	if (decoder.decode(entryBytes) !== entry) {
		throw failure("path-non-utf8");
	}
	validatePathBytes(entryBytes.byteLength);
};

const validateCompiledScriptFormat = (format: number) => {
	if (!Number.isSafeInteger(format) || format < 1) {
		throw failure("compiled-script-invalid");
	}
};

const encodeCompiledScriptText = (text: string) => {
	const bytes = encoder.encode(text);
	try {
		if (compiledScriptDecoder.decode(bytes) !== text) {
			throw failure("compiled-script-invalid");
		}
	} catch {
		throw failure("compiled-script-invalid");
	}
	return bytes;
};

const validateCompiledScripts = (
	manifest: PluginArchivePackage["manifest"],
	files: Readonly<Record<string, Uint8Array>>,
	compiledScripts: ReadonlyArray<PluginArchiveCompiledScript>,
) => {
	const expectedEntries = new Set<string>();
	for (const script of manifest.scripts) {
		validateCompiledScriptEntry(script.entry);
		if (expectedEntries.has(script.entry)) {
			throw failure("compiled-script-invalid");
		}
		expectedEntries.add(script.entry);
	}

	const compiledEntries = new Set<string>();
	const compiledFiles = new Map<string, Uint8Array>();
	const sortedScripts = compiledScripts
		.slice()
		.sort((left, right) => compareCodeUnits(left.entry, right.entry));
	for (const script of sortedScripts) {
		validateCompiledScriptEntry(script.entry);
		validateCompiledScriptFormat(script.format);
		if (!expectedEntries.has(script.entry) || compiledEntries.has(script.entry)) {
			throw failure("compiled-script-invalid");
		}
		compiledEntries.add(script.entry);

		const sourceBytes = files[script.entry];
		if (sourceBytes === undefined) {
			throw failure("compiled-script-invalid");
		}
		try {
			if (decoder.decode(sourceBytes) !== script.source) {
				throw failure("compiled-script-invalid");
			}
		} catch {
			throw failure("compiled-script-invalid");
		}
		if (encoder.encode(script.source).byteLength > PLUGIN_ARCHIVE_LIMITS.maxSourceBytes) {
			throw failure("source-bytes-exceeded");
		}

		const javascriptBytes = encodeCompiledScriptText(script.javascript);
		if (javascriptBytes.byteLength > PLUGIN_ARCHIVE_LIMITS.maxCompiledBackendJavascriptBytes) {
			throw failure("compiled-script-bytes-exceeded");
		}
		const hash = sha256(javascriptBytes);
		const priorBytes = compiledFiles.get(hash);
		if (priorBytes !== undefined && !bytesEqual(priorBytes, javascriptBytes)) {
			throw failure("compiled-script-invalid");
		}
		compiledFiles.set(hash, javascriptBytes);
	}
	if (compiledEntries.size !== expectedEntries.size) {
		throw failure("compiled-script-invalid");
	}
	let totalCompiledBytes = 0;
	for (const bytes of compiledFiles.values()) {
		totalCompiledBytes += bytes.byteLength;
		if (totalCompiledBytes > PLUGIN_ARCHIVE_LIMITS.maxCompiledBackendBytes) {
			throw failure("compiled-script-bytes-exceeded");
		}
	}
	return { compiledFiles, scripts: sortedScripts };
};

const validateCompiledClientFile = (name: string, contentType: string) => {
	if (canonicalRelativePosixPathIssue(name) !== null) {
		throw failure("path-noncanonical");
	}
	if (decoder.decode(encoder.encode(name)) !== name) {
		throw failure("path-non-utf8");
	}
	if (!isPluginClientArtifactContentType(contentType)) {
		throw failure("compiled-client-invalid");
	}
	const archivePath = `${compiledClientFilePrefix}${name}`;
	validatePathBytes(encoder.encode(archivePath).byteLength);
	if (canonicalRelativePosixPathIssue(archivePath) !== null) {
		throw failure("compiled-client-invalid");
	}
	return archivePath;
};

const validateCompiledClientArtifact = (value: PluginClientArtifactType) => {
	let artifact: PluginClientArtifactType;
	try {
		artifact = Schema.decodeUnknownSync(PluginClientArtifact)(value);
	} catch {
		throw failure("compiled-client-invalid");
	}
	if (artifact.files.length > PLUGIN_ARCHIVE_LIMITS.maxCompiledClientFiles) {
		throw failure("compiled-client-file-count-exceeded");
	}
	let artifactBytes = 0;
	for (const file of artifact.files) {
		validateCompiledClientFile(file.name, file.contentType);
		artifactBytes += file.contents.byteLength;
		if (artifactBytes > PLUGIN_ARCHIVE_LIMITS.maxCompiledClientBytes) {
			throw failure("compiled-client-bytes-exceeded");
		}
	}
	return artifact;
};

const validateEntryBytes = (path: string, entryBytes: number, totalBytes: number) => {
	let entryLimit: number;
	let entryLimitReason: PluginArchiveErrorReason;
	if (path === "manifest.json") {
		entryLimit = PLUGIN_ARCHIVE_LIMITS.maxManifestBytes;
		entryLimitReason = "manifest-bytes-exceeded";
	} else if (path === compiledBackendMetadataPath) {
		entryLimit = PLUGIN_ARCHIVE_LIMITS.maxCompiledBackendMetadataBytes;
		entryLimitReason = "compiled-script-metadata-bytes-exceeded";
	} else if (isCompiledBackendFilePath(path)) {
		entryLimit = PLUGIN_ARCHIVE_LIMITS.maxCompiledBackendJavascriptBytes;
		entryLimitReason = "compiled-script-bytes-exceeded";
	} else if (path === compiledClientMetadataPath) {
		entryLimit = PLUGIN_ARCHIVE_LIMITS.maxCompiledClientMetadataBytes;
		entryLimitReason = "compiled-client-metadata-bytes-exceeded";
	} else if (isCompiledClientFilePath(path)) {
		entryLimit = PLUGIN_ARCHIVE_LIMITS.maxCompiledClientBytes;
		entryLimitReason = "compiled-client-bytes-exceeded";
	} else {
		entryLimit = PLUGIN_ARCHIVE_LIMITS.maxSourceBytes;
		entryLimitReason = "source-bytes-exceeded";
	}
	if (entryBytes > entryLimit) {
		throw failure(entryLimitReason);
	}
	if (totalBytes > PLUGIN_ARCHIVE_LIMITS.maxTotalUncompressedBytes) {
		throw failure("total-uncompressed-bytes-exceeded");
	}
};

const validateSourceEncoding = (path: string, bytes: Uint8Array) => {
	if (
		isCompiledBackendFilePath(path) ||
		path === compiledBackendMetadataPath ||
		isCompiledClientFilePath(path) ||
		path === compiledClientMetadataPath
	) {
		return;
	}
	if (path.startsWith("backend/") || isPluginSharedSource(path) || isPluginClientTextSource(path)) {
		try {
			decoder.decode(bytes);
		} catch {
			throw failure("source-non-utf8");
		}
	}
};

class ArchivePathValidator {
	readonly #paths = new Set<string>();
	#entryCount = 0;
	#manifestCount = 0;
	#compiledClientFileCount = 0;

	add(path: string, pathBytes: number) {
		this.#entryCount += 1;
		validateEntryCount(this.#entryCount);
		validatePathBytes(pathBytes);
		if (path.endsWith("/") || path.endsWith("\\")) {
			throw failure("directory-entry");
		}
		if (canonicalRelativePosixPathIssue(path) !== null) {
			throw failure("path-noncanonical");
		}
		if (
			path !== "manifest.json" &&
			path !== compiledBackendMetadataPath &&
			!isCompiledBackendFilePath(path) &&
			path !== compiledClientMetadataPath &&
			!isCompiledClientFilePath(path) &&
			!isPluginSourceFile(path)
		) {
			throw failure("unexpected-entry");
		}
		if (isCompiledClientFilePath(path)) {
			if (path.length === compiledClientFilePrefix.length) {
				throw failure("compiled-client-invalid");
			}
			this.#compiledClientFileCount += 1;
			if (this.#compiledClientFileCount > PLUGIN_ARCHIVE_LIMITS.maxCompiledClientFiles) {
				throw failure("compiled-client-file-count-exceeded");
			}
		}
		if (isCompiledBackendFilePath(path)) {
			const name = path.slice(compiledBackendFilePrefix.length);
			if (!/^[a-f0-9]{64}\.js$/.test(name)) {
				throw failure("compiled-script-invalid");
			}
		}
		if (this.#paths.has(path)) {
			throw failure(path === "manifest.json" ? "duplicate-manifest" : "duplicate-entry");
		}
		this.#paths.add(path);
		if (path === "manifest.json") {
			this.#manifestCount += 1;
		}
	}

	finish() {
		if (this.#manifestCount === 0) {
			throw failure("missing-manifest");
		}
		return this.#paths;
	}
}

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

const createPluginArchive = (entries: ReadonlyArray<readonly [string, Uint8Array]>) => {
	const output: Uint8Array[] = [];
	const zip = new Zip((error, chunk) => {
		if (error !== null) {
			throw new Error(error.message, { cause: error });
		} else if (chunk.byteLength > 0) {
			output.push(chunk.slice());
		}
	});
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

const validateEntries = (entries: ReadonlyArray<readonly [string, Uint8Array]>) => {
	const paths = new ArchivePathValidator();
	let totalBytes = 0;
	let compiledBackendBytes = 0;
	let compiledClientBytes = 0;
	for (const [path, bytes] of entries) {
		const encodedPath = encoder.encode(path);
		if (decoder.decode(encodedPath) !== path) {
			throw failure("path-non-utf8");
		}
		paths.add(path, encodedPath.byteLength);
		totalBytes += bytes.byteLength;
		validateEntryBytes(path, bytes.byteLength, totalBytes);
		if (isCompiledClientFilePath(path)) {
			compiledClientBytes += bytes.byteLength;
			if (compiledClientBytes > PLUGIN_ARCHIVE_LIMITS.maxCompiledClientBytes) {
				throw failure("compiled-client-bytes-exceeded");
			}
		}
		if (isCompiledBackendFilePath(path)) {
			compiledBackendBytes += bytes.byteLength;
			if (compiledBackendBytes > PLUGIN_ARCHIVE_LIMITS.maxCompiledBackendBytes) {
				throw failure("compiled-script-bytes-exceeded");
			}
		}
		validateSourceEncoding(path, bytes);
	}
	paths.finish();
};

type ExtractedEntry = { readonly chunks: Uint8Array[]; bytes: number };

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
	validateEntryCount(entryCount);
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
	const pathValidator = new ArchivePathValidator();
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
		validatePathBytes(localPathBytes);
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
		if ((externalAttributes & 0x10) !== 0 || unixFileType === 0x4000) {
			throw failure("directory-entry");
		}
		pathValidator.add(path, pathBytes);
		offset = end;
	}
	if (offset !== eocd) {
		throw failure("malformed-zip");
	}
	return pathValidator.finish();
};

class PluginArchiveReader {
	readonly #archive: Uint8Array[] = [];
	readonly #entries = new Map<string, ExtractedEntry>();
	#archiveBytes = 0;
	#entryCount = 0;
	#totalBytes = 0;
	#compiledBackendBytes = 0;
	#compiledClientBytes = 0;
	#compiledClientFileCount = 0;
	#unzipFailure: unknown = null;
	#failure: PluginArchiveError | null = null;
	readonly #unzip = new Unzip((file) => {
		this.#entryCount += 1;
		try {
			validateEntryCount(this.#entryCount);
		} catch (error) {
			this.#failure = normalizeError(error);
			return;
		}
		if (isCompiledClientFilePath(file.name)) {
			this.#compiledClientFileCount += 1;
			if (this.#compiledClientFileCount > PLUGIN_ARCHIVE_LIMITS.maxCompiledClientFiles) {
				this.#failure = failure("compiled-client-file-count-exceeded");
				return;
			}
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
			if (isCompiledBackendFilePath(file.name)) {
				this.#compiledBackendBytes += data.byteLength;
				if (this.#compiledBackendBytes > PLUGIN_ARCHIVE_LIMITS.maxCompiledBackendBytes) {
					this.#failure = failure("compiled-script-bytes-exceeded");
					file.terminate();
					return;
				}
			}
			if (isCompiledClientFilePath(file.name)) {
				this.#compiledClientBytes += data.byteLength;
				if (this.#compiledClientBytes > PLUGIN_ARCHIVE_LIMITS.maxCompiledClientBytes) {
					this.#failure = failure("compiled-client-bytes-exceeded");
					file.terminate();
					return;
				}
			}
			try {
				validateEntryBytes(file.name, entry.bytes, this.#totalBytes);
			} catch (validationError) {
				this.#failure = normalizeError(validationError);
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
		validateCompressedBytes(this.#archiveBytes);
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
		const compiledBackendFiles = new Map<string, Uint8Array>();
		const compiledClientFiles = new Map<string, Uint8Array>();
		for (const [path, entry] of this.#entries) {
			if (path === "manifest.json") {
				continue;
			}
			const bytes = concat(entry.chunks, entry.bytes);
			if (path === compiledBackendMetadataPath) {
				continue;
			}
			if (isCompiledBackendFilePath(path)) {
				compiledBackendFiles.set(path, bytes);
				continue;
			}
			if (path === compiledClientMetadataPath) {
				continue;
			}
			if (isCompiledClientFilePath(path)) {
				compiledClientFiles.set(path, bytes);
				continue;
			}
			validateSourceEncoding(path, bytes);
			files[path] = bytes;
		}
		const compiledScripts = this.#readCompiledScripts(compiledBackendFiles, files, manifest);
		const compiledClient = this.#readCompiledClient(compiledClientFiles);
		return {
			files,
			manifest,
			compiledScripts,
			...(compiledClient === undefined ? {} : { compiledClient }),
		} satisfies PluginArchivePackage;
	}

	#readCompiledScripts(
		compiledBackendFiles: ReadonlyMap<string, Uint8Array>,
		sourceFiles: Readonly<Record<string, Uint8Array>>,
		manifest: PluginArchivePackage["manifest"],
	): ReadonlyArray<PluginArchiveCompiledScript> {
		const metadataEntry = this.#entries.get(compiledBackendMetadataPath);
		const expectedEntries = new Set<string>();
		for (const script of manifest.scripts) {
			validateCompiledScriptEntry(script.entry);
			if (expectedEntries.has(script.entry)) {
				throw failure("compiled-script-invalid");
			}
			expectedEntries.add(script.entry);
		}

		if (expectedEntries.size === 0) {
			if (metadataEntry !== undefined || compiledBackendFiles.size > 0) {
				throw failure("compiled-script-invalid");
			}
			return [];
		}
		if (metadataEntry === undefined) {
			throw failure("compiled-script-invalid");
		}

		let metadata: typeof PluginArchiveCompiledScriptsMetadata.Type;
		try {
			metadata = Schema.decodeUnknownSync(PluginArchiveCompiledScriptsMetadata)(
				JSON.parse(decoder.decode(concat(metadataEntry.chunks, metadataEntry.bytes))),
			);
		} catch {
			throw failure("compiled-script-invalid");
		}
		if (metadata.scripts.length !== expectedEntries.size) {
			throw failure("compiled-script-invalid");
		}

		const compiledEntries = new Set<string>();
		const expectedFiles = new Set<string>();
		let previousEntry: string | undefined;
		const compiledScripts = metadata.scripts.map(({ hash, entry, format }) => {
			validateCompiledScriptEntry(entry);
			validateCompiledScriptFormat(format);
			if (
				(previousEntry !== undefined && compareCodeUnits(previousEntry, entry) >= 0) ||
				!expectedEntries.has(entry) ||
				compiledEntries.has(entry) ||
				!/^[a-f0-9]{64}$/.test(hash)
			) {
				throw failure("compiled-script-invalid");
			}
			previousEntry = entry;
			compiledEntries.add(entry);

			const javascriptPath = `${compiledBackendFilePrefix}${hash}.js`;
			const javascriptBytes = compiledBackendFiles.get(javascriptPath);
			if (javascriptBytes === undefined || sha256(javascriptBytes) !== hash) {
				throw failure("compiled-script-invalid");
			}
			expectedFiles.add(javascriptPath);

			let javascript: string;
			let source: string;
			try {
				javascript = compiledScriptDecoder.decode(javascriptBytes);
				const sourceBytes = sourceFiles[entry];
				if (sourceBytes === undefined) {
					throw failure("compiled-script-invalid");
				}
				source = decoder.decode(sourceBytes);
			} catch {
				throw failure("compiled-script-invalid");
			}
			return { entry, source, format, javascript };
		});
		if (
			compiledEntries.size !== expectedEntries.size ||
			expectedFiles.size !== compiledBackendFiles.size
		) {
			throw failure("compiled-script-invalid");
		}
		return compiledScripts;
	}

	#readCompiledClient(compiledClientFiles: ReadonlyMap<string, Uint8Array>) {
		const metadataEntry = this.#entries.get(compiledClientMetadataPath);
		if (metadataEntry === undefined) {
			if (compiledClientFiles.size > 0) {
				throw failure("compiled-client-invalid");
			}
			return undefined;
		}
		let metadata: typeof PluginClientArtifactArchiveMetadata.Type;
		try {
			metadata = Schema.decodeUnknownSync(PluginClientArtifactArchiveMetadata)(
				JSON.parse(decoder.decode(concat(metadataEntry.chunks, metadataEntry.bytes))),
			);
		} catch {
			throw failure("compiled-client-invalid");
		}
		if (metadata.files.length > PLUGIN_ARCHIVE_LIMITS.maxCompiledClientFiles) {
			throw failure("compiled-client-file-count-exceeded");
		}
		if (metadata.files.length !== compiledClientFiles.size) {
			throw failure("compiled-client-invalid");
		}
		const files = metadata.files.map(({ name, contentType }) => {
			const path = validateCompiledClientFile(name, contentType);
			const contents = compiledClientFiles.get(path);
			if (contents === undefined) {
				throw failure("compiled-client-invalid");
			}
			return { name, contents, contentType };
		});
		try {
			return Schema.decodeUnknownSync(PluginClientArtifact)({ ...metadata, files });
		} catch {
			throw failure("compiled-client-invalid");
		}
	}
}

const readPluginArchiveBytes = (bytes: Uint8Array) => {
	const reader = new PluginArchiveReader();
	reader.push(bytes, true);
	return reader.finish();
};

export const writePluginArchive = (pluginPackage: PluginArchiveInput) => {
	try {
		let manifestBytes: Uint8Array;
		try {
			manifestBytes = encoder.encode(`${JSON.stringify(pluginPackage.manifest, null, "\t")}\n`);
		} catch {
			throw failure("manifest-invalid");
		}
		const sourceFiles = Object.entries(pluginPackage.files).sort(([left], [right]) => {
			const rankDifference = sourcePathRank(left) - sourcePathRank(right);
			return rankDifference === 0 ? compareCodeUnits(left, right) : rankDifference;
		});
		const entries: Array<readonly [string, Uint8Array]> = [
			["manifest.json", manifestBytes],
			...sourceFiles,
		];
		const compiledScripts = validateCompiledScripts(
			pluginPackage.manifest,
			pluginPackage.files,
			pluginPackage.compiledScripts ?? [],
		);
		if (compiledScripts.scripts.length > 0) {
			const metadata = {
				scripts: compiledScripts.scripts.map(({ entry, format, javascript }) => ({
					entry,
					format,
					hash: sha256(encoder.encode(javascript)),
				})),
			};
			const compiledBackendEntries: Array<readonly [string, Uint8Array]> = [
				[compiledBackendMetadataPath, encoder.encode(`${JSON.stringify(metadata, null, "\t")}\n`)],
				...[...compiledScripts.compiledFiles].map(
					([hash, bytes]) => [`${compiledBackendFilePrefix}${hash}.js`, bytes] as const,
				),
			];
			compiledBackendEntries.sort(([left], [right]) => compareCodeUnits(left, right));
			entries.push(...compiledBackendEntries);
		}
		if (pluginPackage.compiledClient !== undefined) {
			const artifact = validateCompiledClientArtifact(pluginPackage.compiledClient);
			const metadata = {
				hash: artifact.hash,
				format: artifact.format,
				apiVersion: artifact.apiVersion,
				bridgeVersion: artifact.bridgeVersion,
				compilerVersion: artifact.compilerVersion,
				files: artifact.files
					.map(({ name, contentType }) => ({ name, contentType }))
					.sort((left, right) => compareCodeUnits(left.name, right.name)),
			};
			const compiledClientEntries: Array<readonly [string, Uint8Array]> = [
				[compiledClientMetadataPath, encoder.encode(`${JSON.stringify(metadata, null, "\t")}\n`)],
				...artifact.files.map(
					({ name, contents, contentType }) =>
						[validateCompiledClientFile(name, contentType), contents] as const,
				),
			];
			compiledClientEntries.sort(([left], [right]) => compareCodeUnits(left, right));
			entries.push(...compiledClientEntries);
		}
		validateEntries(entries);
		const archive = createPluginArchive(entries);
		readPluginArchiveBytes(archive);
		return archive;
	} catch (error) {
		throw normalizeError(error);
	}
};

export const readPluginArchive = (
	input: Uint8Array | AsyncIterable<Uint8Array>,
): Effect.Effect<PluginArchivePackage, PluginArchiveError> =>
	Effect.tryPromise({
		catch: normalizeError,
		try: async () => {
			if (input instanceof Uint8Array) {
				return readPluginArchiveBytes(input);
			}
			const reader = new PluginArchiveReader();
			for await (const chunk of input) {
				reader.push(chunk, false);
			}
			reader.push(new Uint8Array(0), true);
			return reader.finish();
		},
	});

export const readPluginArchiveStream = <E>(
	input: Stream.Stream<Uint8Array, E>,
): Effect.Effect<PluginArchivePackage, E | PluginArchiveError> =>
	Effect.gen(function* () {
		const reader = new PluginArchiveReader();
		yield* Stream.runForEach(input, (chunk) =>
			Effect.try({ catch: normalizeError, try: () => reader.push(chunk, false) }),
		);
		yield* Effect.try({ catch: normalizeError, try: () => reader.push(new Uint8Array(0), true) });
		return yield* Effect.try({ catch: normalizeError, try: () => reader.finish() });
	});
