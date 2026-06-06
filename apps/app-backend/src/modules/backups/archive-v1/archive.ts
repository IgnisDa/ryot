import { Schema, Effect, Stream, FileSystem, type PlatformError } from "effect";
import { Zip, Unzip, ZipDeflate, UnzipInflate, ZipPassThrough, UnzipPassThrough } from "fflate";

import { archiveError, BackupArchiveError } from "./error";
import {
	V1_CODECS,
	V1Manifest,
	V1Profile,
	type V1EntityDependency,
	V1_SECTION_PATHS,
	type V1AssetManifest,
	type V1ArchiveRecords,
	type V1RequiredPlugin,
	type V1SectionManifest,
	type V1SectionPath,
} from "./schemas";
import { decodeNdjson, encodeNdjson, IncrementalSha256 } from "./streaming";

const ZIP_EOCD_BYTES = 22;
const MAX_ZIP_PATH_BYTES = 71;
const encoder = new TextEncoder();
const ZIP_MAX_COMMENT_BYTES = 65_535;
const ZIP_CENTRAL_HEADER_BYTES = 46;
const DETERMINISTIC_MTIME = new Date("1980-01-01T00:00:00.000Z");
const decoder = new TextDecoder("utf-8", { fatal: true });

export const V1_ARCHIVE_LIMITS = {
	maxEntryCount: 4_096,
	maxRecordsPerSection: 250_000,
	maxEntryBytes: 256 * 1024 * 1024,
	maxMetadataEntryBytes: 32 * 1024 * 1024,
	maxTotalUncompressedBytes: 1024 * 1024 * 1024,
} as const;

type V1ArchiveLimits = {
	readonly [K in keyof typeof V1_ARCHIVE_LIMITS]: number;
};

type V1ArchiveAssetInput = {
	readonly metadata: V1AssetManifest;
	readonly chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
};

export type CreateV1ArchiveInput = {
	readonly archiveId: string;
	readonly appVersion: string;
	readonly createdAt: string;
	readonly records: V1ArchiveRecords;
	readonly redactions: ReadonlyArray<string>;
	readonly compression?: "deflate" | "store";
	readonly assets: ReadonlyArray<V1ArchiveAssetInput>;
	readonly requiredPlugins: ReadonlyArray<V1RequiredPlugin>;
};

type V1ZipEntryInput = {
	readonly path: string;
	readonly compression: "deflate" | "store";
	readonly chunks: Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
};

const recordCollections = (records: V1ArchiveRecords) => ({
	"events.ndjson": records.events,
	"entities.ndjson": records.entities,
	"saved-views.ndjson": records.savedViews,
	"plugin-state.ndjson": records.pluginState,
	"relationships.ndjson": records.relationships,
	"entity-dependencies.ndjson": records.entityDependencies,
	"notification-subscriptions.ndjson": records.notificationSubscriptions,
});

const compareId = (left: { readonly id: string }, right: { readonly id: string }) =>
	left.id.localeCompare(right.id);

const sortedIfNeeded = <A>(values: ReadonlyArray<A>, compare: (left: A, right: A) => number) => {
	for (let index = 1; index < values.length; index += 1) {
		const previous = values[index - 1];
		const current = values[index];
		if (previous !== undefined && current !== undefined && compare(previous, current) > 0) {
			return [...values].sort(compare);
		}
	}
	return values;
};

const sortDependencies = (values: V1ArchiveRecords["entityDependencies"]) => {
	let updated: V1EntityDependency[] | undefined;
	for (const [index, entity] of values.entries()) {
		const translations = sortedIfNeeded(entity.translations, compareId);
		if (translations !== entity.translations) {
			updated ??= [...values];
			updated[index] = { ...entity, translations };
		}
	}
	return sortedIfNeeded(updated ?? values, compareId);
};

export const sortV1ArchiveRecords = (records: V1ArchiveRecords): V1ArchiveRecords => ({
	profile: records.profile,
	events: sortedIfNeeded(records.events, compareId),
	entities: sortedIfNeeded(records.entities, compareId),
	entityDependencies: sortDependencies(records.entityDependencies),
	savedViews: sortedIfNeeded(records.savedViews, compareId),
	pluginState: sortedIfNeeded(records.pluginState, compareId),
	relationships: sortedIfNeeded(records.relationships, compareId),
	notificationSubscriptions: sortedIfNeeded(records.notificationSubscriptions, (left, right) =>
		left.signalSchemaSlug.localeCompare(right.signalSchemaSlug),
	),
});

function* sectionChunks(path: Exclude<V1SectionPath, "profile.json">, records: V1ArchiveRecords) {
	const values = recordCollections(records)[path];
	const codec = V1_CODECS[path] as Schema.Codec<(typeof values)[number], unknown>;
	yield* encodeNdjson(values, codec);
}

const profileChunk = (profile: V1Profile) =>
	encoder.encode(`${JSON.stringify(Schema.encodeUnknownSync(V1Profile)(profile))}\n`);

const measureChunks = (chunks: Iterable<Uint8Array>, count: number) => {
	const hash = new IncrementalSha256();
	for (const chunk of chunks) {
		hash.update(chunk);
	}
	return { count, ...hash.digest() };
};

const sectionManifest = (path: V1SectionPath, chunks: Iterable<Uint8Array>, count: number) => {
	const { bytes, ...measured } = measureChunks(chunks, count);
	return { bytes, manifest: { ...measured, path } satisfies V1SectionManifest };
};

const requireUniqueIds = (path: string, records: ReadonlyArray<{ readonly id: string }>) => {
	const ids = new Set<string>();
	for (const record of records) {
		if (ids.has(record.id)) {
			throw archiveError("duplicate_record_id", `Duplicate record id '${record.id}'`, path);
		}
		ids.add(record.id);
	}
};

const validateRecordKeys = (records: V1ArchiveRecords) => {
	requireUniqueIds("events.ndjson", records.events);
	requireUniqueIds("entities.ndjson", records.entities);
	requireUniqueIds("saved-views.ndjson", records.savedViews);
	requireUniqueIds("plugin-state.ndjson", records.pluginState);
	requireUniqueIds("relationships.ndjson", records.relationships);
	requireUniqueIds("entity-dependencies.ndjson", records.entityDependencies);
	const entityIds = new Set(records.entities.map(({ id }) => id));
	const translationIds = new Set<string>();
	for (const dependency of records.entityDependencies) {
		if (entityIds.has(dependency.id)) {
			throw archiveError(
				"duplicate_record_id",
				`Entity id '${dependency.id}' is duplicated across entity sections`,
				"entity-dependencies.ndjson",
			);
		}
		const languages = new Set<string>();
		for (const translation of dependency.translations) {
			if (translationIds.has(translation.id)) {
				throw archiveError(
					"duplicate_record_id",
					`Duplicate translation id '${translation.id}'`,
					"entity-dependencies.ndjson",
				);
			}
			if (languages.has(translation.language)) {
				throw archiveError(
					"duplicate_record_id",
					`Duplicate translation language '${translation.language}' for entity '${dependency.id}'`,
					"entity-dependencies.ndjson",
				);
			}
			translationIds.add(translation.id);
			languages.add(translation.language);
		}
	}
	const viewSlugs = new Set<string>();
	for (const view of records.savedViews) {
		if (viewSlugs.has(view.slug)) {
			throw archiveError(
				"duplicate_record_id",
				`Duplicate saved view slug '${view.slug}'`,
				"saved-views.ndjson",
			);
		}
		viewSlugs.add(view.slug);
	}
	const signalSlugs = new Set<string>();
	for (const subscription of records.notificationSubscriptions) {
		if (signalSlugs.has(subscription.signalSchemaSlug)) {
			throw archiveError(
				"duplicate_record_id",
				`Duplicate signal schema slug '${subscription.signalSchemaSlug}'`,
				"notification-subscriptions.ndjson",
			);
		}
		signalSlugs.add(subscription.signalSchemaSlug);
	}
};

const validateRequiredPlugins = (plugins: ReadonlyArray<V1RequiredPlugin>) => {
	const slugs = new Set<string>();
	for (const plugin of plugins) {
		if (slugs.has(plugin.slug)) {
			throw archiveError(
				"duplicate_record_id",
				`Duplicate required plugin slug '${plugin.slug}'`,
				"manifest.json",
			);
		}
		slugs.add(plugin.slug);
	}
};

const sortedRequiredPlugins = (plugins: ReadonlyArray<V1RequiredPlugin>) => {
	validateRequiredPlugins(plugins);
	return [...plugins].sort(
		(left, right) =>
			left.slug.localeCompare(right.slug) || left.version.localeCompare(right.version),
	);
};

const buildManifest = (
	input: CreateV1ArchiveInput,
	records: V1ArchiveRecords,
	limits: V1ArchiveLimits,
) => {
	validateRecordKeys(records);
	for (const [path, values] of Object.entries(recordCollections(records))) {
		if (values.length > limits.maxRecordsPerSection) {
			throw archiveError("count_mismatch", "Section record limit exceeded", path);
		}
	}
	const sections = [
		sectionManifest("profile.json", [profileChunk(records.profile)], 1),
		sectionManifest(
			"plugin-state.ndjson",
			sectionChunks("plugin-state.ndjson", records),
			records.pluginState.length,
		),
		sectionManifest(
			"entities.ndjson",
			sectionChunks("entities.ndjson", records),
			records.entities.length,
		),
		sectionManifest(
			"entity-dependencies.ndjson",
			sectionChunks("entity-dependencies.ndjson", records),
			records.entityDependencies.length,
		),
		sectionManifest(
			"relationships.ndjson",
			sectionChunks("relationships.ndjson", records),
			records.relationships.length,
		),
		sectionManifest(
			"events.ndjson",
			sectionChunks("events.ndjson", records),
			records.events.length,
		),
		sectionManifest(
			"saved-views.ndjson",
			sectionChunks("saved-views.ndjson", records),
			records.savedViews.length,
		),
		sectionManifest(
			"notification-subscriptions.ndjson",
			sectionChunks("notification-subscriptions.ndjson", records),
			records.notificationSubscriptions.length,
		),
	];
	for (const section of sections) {
		if (section.bytes > limits.maxMetadataEntryBytes) {
			throw archiveError("entry_too_large", "ZIP entry is too large", section.manifest.path);
		}
	}
	const declaredAssets = new Set<string>();
	for (const asset of input.assets) {
		if (asset.metadata.path !== `assets/${asset.metadata.sha256}`) {
			throw archiveError(
				"invalid_entry",
				"Asset path does not match its SHA-256",
				asset.metadata.path,
			);
		}
		if (declaredAssets.has(asset.metadata.path)) {
			throw archiveError("duplicate_path", "Duplicate asset path", asset.metadata.path);
		}
		if (asset.metadata.size > limits.maxEntryBytes) {
			throw archiveError("entry_too_large", "ZIP entry is too large", asset.metadata.path);
		}
		declaredAssets.add(asset.metadata.path);
	}
	if (sections.length + input.assets.length + 1 > limits.maxEntryCount) {
		throw archiveError("entry_count_exceeded", "ZIP entry limit exceeded");
	}
	const manifest = Schema.decodeUnknownSync(V1Manifest)({
		version: 1,
		format: "ryot-backup",
		createdAt: input.createdAt,
		archiveId: input.archiveId,
		appVersion: input.appVersion,
		redactions: [...input.redactions].sort(),
		sections: sections.map(({ manifest: section }) => section),
		requiredPlugins: sortedRequiredPlugins(input.requiredPlugins),
		assets: input.assets
			.map(({ metadata }) => metadata)
			.sort((a, b) => a.path.localeCompare(b.path)),
	});
	const manifestBytes = encoder.encode(
		`${JSON.stringify(Schema.encodeUnknownSync(V1Manifest)(manifest))}\n`,
	).byteLength;
	if (manifestBytes > limits.maxMetadataEntryBytes) {
		throw archiveError("entry_too_large", "ZIP entry is too large", "manifest.json");
	}
	const totalBytes =
		manifestBytes +
		sections.reduce((total, section) => total + section.bytes, 0) +
		input.assets.reduce((total, asset) => total + asset.metadata.size, 0);
	if (totalBytes > limits.maxTotalUncompressedBytes) {
		throw archiveError("total_size_exceeded", "ZIP total size limit exceeded");
	}
	return manifest;
};

const asyncIterator = <A>(values: Iterable<A> | AsyncIterable<A>): AsyncIterator<A> => {
	if (Symbol.asyncIterator in values) {
		return values[Symbol.asyncIterator]();
	}
	const iterator = values[Symbol.iterator]();
	return { next: () => Promise.resolve(iterator.next()) };
};

class ZipChunkIterator implements AsyncIterableIterator<Uint8Array> {
	#ended = false;
	readonly #zip: Zip;
	readonly #output: Uint8Array[] = [];
	#failure: BackupArchiveError | null = null;
	#chunks: AsyncIterator<Uint8Array> | null = null;
	#file: ZipPassThrough | ZipDeflate | null = null;
	readonly #entries: AsyncIterator<V1ZipEntryInput>;

	constructor(entries: Iterable<V1ZipEntryInput> | AsyncIterable<V1ZipEntryInput>) {
		this.#entries = asyncIterator(entries);
		this.#zip = new Zip((error, chunk) => {
			if (error !== null) {
				this.#failure = archiveError("invalid_archive", error.message);
			} else if (chunk.byteLength > 0) {
				this.#output.push(chunk);
			}
		});
	}

	[Symbol.asyncIterator]() {
		return this;
	}

	next(): Promise<IteratorResult<Uint8Array, void>> {
		const output = this.#output.shift();
		if (output !== undefined) {
			return Promise.resolve({ done: false, value: output });
		}
		if (this.#failure !== null) {
			return Promise.reject(this.#failure);
		}
		if (this.#ended) {
			return Promise.resolve({ done: true, value: undefined });
		}
		return this.#advance().catch((error: unknown) => {
			this.#zip.terminate();
			throw error instanceof BackupArchiveError
				? error
				: archiveError("invalid_archive", "ZIP encoding failed");
		});
	}

	#advance(): Promise<IteratorResult<Uint8Array, void>> {
		if (this.#chunks !== null && this.#file !== null) {
			return this.#chunks.next().then((next) => {
				if (next.done) {
					this.#file?.push(new Uint8Array(0), true);
					this.#chunks = null;
					this.#file = null;
				} else {
					this.#file?.push(next.value);
				}
				return this.next();
			});
		}
		return this.#entries.next().then((next) => {
			if (next.done) {
				this.#zip.end();
				this.#ended = true;
				return this.next();
			}
			this.#file =
				next.value.compression === "store"
					? new ZipPassThrough(next.value.path)
					: new ZipDeflate(next.value.path, { level: 6 });
			this.#file.mtime = DETERMINISTIC_MTIME;
			this.#file.os = 0;
			this.#zip.add(this.#file);
			this.#chunks = asyncIterator(next.value.chunks);
			return this.next();
		});
	}

	return(): Promise<IteratorResult<Uint8Array, void>> {
		this.#zip.terminate();
		this.#ended = true;
		return Promise.resolve({ done: true, value: undefined });
	}
}

export const zipChunks = (entries: Iterable<V1ZipEntryInput> | AsyncIterable<V1ZipEntryInput>) =>
	new ZipChunkIterator(entries);

class VerifiedAssetChunks implements AsyncIterableIterator<Uint8Array> {
	readonly #limits: V1ArchiveLimits;
	readonly #asset: V1ArchiveAssetInput;
	readonly #hash = new IncrementalSha256();
	readonly #chunks: AsyncIterator<Uint8Array>;

	constructor(asset: V1ArchiveAssetInput, limits: V1ArchiveLimits) {
		this.#asset = asset;
		this.#limits = limits;
		this.#chunks = asyncIterator(asset.chunks);
	}

	[Symbol.asyncIterator]() {
		return this;
	}

	next(): Promise<IteratorResult<Uint8Array, void>> {
		return this.#chunks.next().then((next) => {
			if (!next.done) {
				this.#hash.update(next.value);
				if (this.#hash.bytes > this.#limits.maxEntryBytes) {
					throw archiveError(
						"entry_too_large",
						"ZIP entry is too large",
						this.#asset.metadata.path,
					);
				}
				return next;
			}
			const measured = this.#hash.digest();
			if (
				measured.bytes !== this.#asset.metadata.size ||
				measured.sha256 !== this.#asset.metadata.sha256
			) {
				throw archiveError(
					"checksum_mismatch",
					"Asset stream does not match its manifest metadata",
					this.#asset.metadata.path,
				);
			}
			return next;
		});
	}
}

const createV1Archive = (input: CreateV1ArchiveInput, overrides: Partial<V1ArchiveLimits> = {}) => {
	const limits = { ...V1_ARCHIVE_LIMITS, ...overrides };
	const records = sortV1ArchiveRecords(input.records);
	const manifest = buildManifest(input, records, limits);
	const compression = input.compression ?? "deflate";
	const assets = [...input.assets].sort((left, right) =>
		left.metadata.path.localeCompare(right.metadata.path),
	);
	const entries: V1ZipEntryInput[] = [
		{
			compression,
			path: "manifest.json",
			chunks: [
				encoder.encode(`${JSON.stringify(Schema.encodeUnknownSync(V1Manifest)(manifest))}\n`),
			],
		},
		{ compression, path: "profile.json", chunks: [profileChunk(records.profile)] },
		...V1_SECTION_PATHS.filter((path) => path !== "profile.json").map((path) => ({
			path,
			compression,
			chunks: sectionChunks(path, records),
		})),
		...assets.map((asset) => ({
			path: asset.metadata.path,
			compression: "store" as const,
			chunks: new VerifiedAssetChunks(asset, limits),
		})),
	];
	return zipChunks(entries);
};

export const createV1ArchiveStream = (
	input: CreateV1ArchiveInput,
	overrides: Partial<V1ArchiveLimits> = {},
) =>
	Stream.fromAsyncIterable(createV1Archive(input, overrides), (error) =>
		error instanceof BackupArchiveError
			? error
			: archiveError("invalid_archive", "ZIP encoding failed"),
	);

type ExtractedEntry = {
	readonly path: string;
	readonly bytes: number;
	readonly sha256: string;
	readonly assetPath?: string;
	readonly compression: number;
	chunks?: Uint8Array[] | undefined;
};

type ValidatedV1Asset = V1AssetManifest & {
	readonly filePath: string;
	readonly stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>;
};

type ValidatedV1Archive = {
	readonly manifest: V1Manifest;
	readonly records: V1ArchiveRecords;
	readonly assets: ReadonlyArray<ValidatedV1Asset>;
	readonly cleanup: Effect.Effect<void, PlatformError.PlatformError>;
};

const validPath = (path: string) => {
	if (path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path)) {
		return false;
	}
	return !path.split(/[\\/]/).some((segment) => segment === "..");
};

const SECTION_PATHS = new Set<string>(V1_SECTION_PATHS);

const allowedPath = (path: string) =>
	path === "manifest.json" || SECTION_PATHS.has(path) || /^assets\/[a-f0-9]{64}$/.test(path);

const requireEntry = (entries: ReadonlyMap<string, ExtractedEntry>, path: string) => {
	const entry = entries.get(path);
	if (entry === undefined) {
		throw archiveError("missing_entry", `Archive is missing ${path}`, path);
	}
	return entry;
};

const concatChunks = (chunks: ReadonlyArray<Uint8Array>) => {
	const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
};

const takeChunks = (entry: ExtractedEntry) => {
	const chunks = entry.chunks ?? [];
	entry.chunks = undefined;
	return chunks;
};

const decodeJson = <A, I>(codec: Schema.Codec<A, I>, entry: ExtractedEntry) => {
	const chunks = takeChunks(entry);
	try {
		return Schema.decodeUnknownSync(codec)(JSON.parse(decoder.decode(concatChunks(chunks))));
	} catch {
		throw archiveError("invalid_entry", `Invalid ${entry.path}`, entry.path);
	}
};

const decodeRecords = <A, I>(codec: Schema.Codec<A, I>, entry: ExtractedEntry, limit: number) => {
	const records: A[] = [];
	for (const record of decodeNdjson(takeChunks(entry), codec, entry.path)) {
		records.push(record);
		if (records.length > limit) {
			throw archiveError("count_mismatch", "Section record limit exceeded", entry.path);
		}
	}
	return records;
};

const validateSectionIntegrity = (
	path: V1SectionPath,
	entry: ExtractedEntry,
	declared: V1SectionManifest,
) => {
	if (entry.sha256 !== declared.sha256) {
		throw archiveError("checksum_mismatch", `Section checksum mismatch`, path);
	}
};

const validateSectionCount = (path: V1SectionPath, declared: V1SectionManifest, count: number) => {
	if (count !== declared.count) {
		throw archiveError("count_mismatch", `Section count mismatch`, path);
	}
};

const manifestSections = (sections: ReadonlyArray<V1SectionManifest>) => {
	const byPath = new Map<string, V1SectionManifest>();
	for (const section of sections) {
		if (byPath.has(section.path)) {
			throw archiveError("duplicate_path", "Duplicate manifest section path", section.path);
		}
		byPath.set(section.path, section);
	}
	for (const path of V1_SECTION_PATHS) {
		if (!byPath.has(path)) {
			throw archiveError("missing_entry", "Manifest section is missing", path);
		}
	}
	for (const [index, section] of sections.entries()) {
		if (section.path !== V1_SECTION_PATHS[index]) {
			throw archiveError(
				"invalid_entry",
				"Manifest sections are not in path order",
				"manifest.json",
			);
		}
	}
	return byPath;
};

const validateExtracted = (
	entries: ReadonlyMap<string, ExtractedEntry>,
	directory: string,
	fs: FileSystem.FileSystem,
	limits: V1ArchiveLimits,
): ValidatedV1Archive => {
	const manifestEntry = entries.get("manifest.json");
	if (manifestEntry === undefined) {
		throw archiveError("missing_entry", "Archive is missing manifest.json", "manifest.json");
	}
	let manifest: V1Manifest;
	try {
		manifest = decodeJson(V1Manifest, manifestEntry);
	} catch (error) {
		throw error instanceof BackupArchiveError && error.reason === "invalid_entry"
			? archiveError("unsupported_format", "Unsupported backup format or version", "manifest.json")
			: error;
	}
	validateRequiredPlugins(manifest.requiredPlugins);
	const sections = manifestSections(manifest.sections);
	for (const path of V1_SECTION_PATHS) {
		if (!entries.has(path)) {
			throw archiveError("missing_entry", `Archive is missing ${path}`, path);
		}
	}
	const profileEntry = requireEntry(entries, "profile.json");
	const profileSection = sections.get("profile.json");
	if (profileSection === undefined) {
		throw archiveError("missing_entry", "Manifest section is missing", "profile.json");
	}
	validateSectionIntegrity("profile.json", profileEntry, profileSection);
	const profile = decodeJson(V1Profile, profileEntry);
	validateSectionCount("profile.json", profileSection, 1);

	const readSection = <A, I>(
		path: Exclude<V1SectionPath, "profile.json">,
		codec: Schema.Codec<A, I>,
	) => {
		const entry = requireEntry(entries, path);
		const section = sections.get(path);
		if (section === undefined) {
			throw archiveError("missing_entry", "Manifest section is missing", path);
		}
		validateSectionIntegrity(path, entry, section);
		const records = decodeRecords(codec, entry, limits.maxRecordsPerSection);
		validateSectionCount(path, section, records.length);
		return records;
	};
	const events = readSection("events.ndjson", V1_CODECS["events.ndjson"]);
	const entities = readSection("entities.ndjson", V1_CODECS["entities.ndjson"]);
	const savedViews = readSection("saved-views.ndjson", V1_CODECS["saved-views.ndjson"]);
	const pluginState = readSection("plugin-state.ndjson", V1_CODECS["plugin-state.ndjson"]);
	const relationships = readSection("relationships.ndjson", V1_CODECS["relationships.ndjson"]);
	const dependencies = readSection(
		"entity-dependencies.ndjson",
		V1_CODECS["entity-dependencies.ndjson"],
	);
	const notificationSubscriptions = readSection(
		"notification-subscriptions.ndjson",
		V1_CODECS["notification-subscriptions.ndjson"],
	);
	validateRecordKeys({
		profile,
		events,
		entities,
		savedViews,
		pluginState,
		relationships,
		notificationSubscriptions,
		entityDependencies: dependencies,
	});

	const declaredAssets = new Map<string, V1AssetManifest>();
	for (const asset of manifest.assets) {
		if (asset.path !== `assets/${asset.sha256}` || declaredAssets.has(asset.path)) {
			throw archiveError("invalid_entry", `Invalid or duplicate asset declaration`, asset.path);
		}
		declaredAssets.set(asset.path, asset);
	}
	for (const [path, entry] of entries) {
		if (!path.startsWith("assets/")) {
			continue;
		}
		const declared = declaredAssets.get(path);
		if (declared === undefined) {
			throw archiveError("undeclared_asset", `Asset is not declared by the manifest`, path);
		}
		if (entry.bytes !== declared.size || entry.sha256 !== declared.sha256) {
			throw archiveError("checksum_mismatch", `Asset checksum or size mismatch`, path);
		}
	}
	for (const path of declaredAssets.keys()) {
		if (!entries.has(path)) {
			throw archiveError("missing_entry", `Declared asset is missing`, path);
		}
	}
	const assets = [...declaredAssets.values()].map((asset) => {
		const filePath = requireEntry(entries, asset.path).assetPath;
		if (filePath === undefined) {
			throw archiveError("invalid_entry", "Asset was not spooled", asset.path);
		}
		return Object.assign({}, asset, { filePath, stream: fs.stream(filePath) });
	});
	return {
		assets,
		manifest,
		cleanup: fs.remove(directory, { recursive: true, force: true }),
		records: {
			events,
			profile,
			entities,
			savedViews,
			pluginState,
			relationships,
			notificationSubscriptions,
			entityDependencies: dependencies,
		},
	};
};

class BoundedTail {
	#length = 0;
	#position = 0;
	readonly #buffer: Uint8Array;

	constructor(capacity: number) {
		this.#buffer = new Uint8Array(capacity);
	}

	update(chunk: Uint8Array) {
		if (chunk.byteLength >= this.#buffer.byteLength) {
			this.#buffer.set(chunk.subarray(chunk.byteLength - this.#buffer.byteLength));
			this.#length = this.#buffer.byteLength;
			this.#position = 0;
			return;
		}
		let offset = 0;
		while (offset < chunk.byteLength) {
			const size = Math.min(chunk.byteLength - offset, this.#buffer.byteLength - this.#position);
			this.#buffer.set(chunk.subarray(offset, offset + size), this.#position);
			this.#position = (this.#position + size) % this.#buffer.byteLength;
			this.#length = Math.min(this.#length + size, this.#buffer.byteLength);
			offset += size;
		}
	}

	bytes() {
		const output = new Uint8Array(this.#length);
		const start =
			(this.#position - this.#length + this.#buffer.byteLength) % this.#buffer.byteLength;
		const first = Math.min(this.#length, this.#buffer.byteLength - start);
		output.set(this.#buffer.subarray(start, start + first));
		output.set(this.#buffer.subarray(0, this.#length - first), first);
		return output;
	}
}

const zipSignatureAt = (view: DataView, offset: number, signature: number) =>
	offset >= 0 && offset + 4 <= view.byteLength && view.getUint32(offset, true) === signature;

const validateZipStructure = (
	tail: Uint8Array,
	archiveBytes: number,
	entries: ReadonlyMap<string, ExtractedEntry>,
	limits: V1ArchiveLimits,
) => {
	const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
	let eocd = -1;
	for (let offset = tail.byteLength - ZIP_EOCD_BYTES; offset >= 0; offset -= 1) {
		if (
			zipSignatureAt(view, offset, 0x06054b50) &&
			offset + ZIP_EOCD_BYTES + view.getUint16(offset + 20, true) === tail.byteLength
		) {
			eocd = offset;
			break;
		}
	}
	if (eocd < 0) {
		throw archiveError("invalid_archive", "ZIP end of central directory is missing or truncated");
	}
	if (zipSignatureAt(view, eocd - 20, 0x07064b50)) {
		throw archiveError("unsupported_format", "Zip64 archives are not supported");
	}
	const disk = view.getUint16(eocd + 4, true);
	const centralDisk = view.getUint16(eocd + 6, true);
	const diskEntries = view.getUint16(eocd + 8, true);
	const entryCount = view.getUint16(eocd + 10, true);
	const centralBytes = view.getUint32(eocd + 12, true);
	const centralOffset = view.getUint32(eocd + 16, true);
	if (disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount) {
		throw archiveError("unsupported_format", "Multidisk ZIP archives are not supported");
	}
	if (entryCount === 0xffff || centralBytes === 0xffffffff || centralOffset === 0xffffffff) {
		throw archiveError("unsupported_format", "Zip64 archives are not supported");
	}
	if (entryCount > limits.maxEntryCount) {
		throw archiveError("entry_count_exceeded", "ZIP entry limit exceeded");
	}
	if (centralBytes > entryCount * (ZIP_CENTRAL_HEADER_BYTES + MAX_ZIP_PATH_BYTES)) {
		throw archiveError("invalid_archive", "ZIP central directory is too large");
	}
	const tailOffset = archiveBytes - tail.byteLength;
	const eocdOffset = tailOffset + eocd;
	if (centralOffset + centralBytes !== eocdOffset || centralOffset < tailOffset) {
		throw archiveError("invalid_archive", "ZIP central directory offset or boundary is invalid");
	}
	let offset = centralOffset - tailOffset;
	const centralEnd = offset + centralBytes;
	const offsets: Array<{
		readonly offset: number;
		readonly dataEnd: number;
		readonly hasDescriptor: boolean;
	}> = [];
	const paths = new Set<string>();
	for (let index = 0; index < entryCount; index += 1) {
		if (
			!zipSignatureAt(view, offset, 0x02014b50) ||
			offset + ZIP_CENTRAL_HEADER_BYTES > centralEnd
		) {
			throw archiveError("invalid_archive", "ZIP central directory entry is truncated");
		}
		const flags = view.getUint16(offset + 8, true);
		const compression = view.getUint16(offset + 10, true);
		const compressedSize = view.getUint32(offset + 20, true);
		const uncompressedSize = view.getUint32(offset + 24, true);
		const nameBytes = view.getUint16(offset + 28, true);
		const extraBytes = view.getUint16(offset + 30, true);
		const commentBytes = view.getUint16(offset + 32, true);
		const startDisk = view.getUint16(offset + 34, true);
		const localOffset = view.getUint32(offset + 42, true);
		const entryEnd = offset + ZIP_CENTRAL_HEADER_BYTES + nameBytes + extraBytes + commentBytes;
		if (entryEnd > centralEnd) {
			throw archiveError("invalid_archive", "ZIP central directory entry is truncated");
		}
		if (extraBytes !== 0 || commentBytes !== 0 || nameBytes > MAX_ZIP_PATH_BYTES) {
			throw archiveError("unsupported_format", "ZIP entry extras or comments are not supported");
		}
		if (startDisk !== 0) {
			throw archiveError("unsupported_format", "Multidisk ZIP archives are not supported");
		}
		if (
			compressedSize === 0xffffffff ||
			uncompressedSize === 0xffffffff ||
			localOffset === 0xffffffff
		) {
			throw archiveError("unsupported_format", "Zip64 archives are not supported");
		}
		if ((flags & 1) !== 0 || (compression !== 0 && compression !== 8)) {
			throw archiveError("unsupported_compression", "Unsupported ZIP compression or encryption");
		}
		let path: string;
		try {
			path = decoder.decode(
				tail.subarray(
					offset + ZIP_CENTRAL_HEADER_BYTES,
					offset + ZIP_CENTRAL_HEADER_BYTES + nameBytes,
				),
			);
		} catch {
			throw archiveError("invalid_path", "ZIP entry path is not valid UTF-8");
		}
		const extracted = entries.get(path);
		if (extracted === undefined || paths.has(path)) {
			throw archiveError(
				"invalid_archive",
				"ZIP central directory does not match extracted entries",
				path,
			);
		}
		if (extracted.bytes !== uncompressedSize || extracted.compression !== compression) {
			throw archiveError(
				"invalid_archive",
				"ZIP central directory method or size does not match entry",
				path,
			);
		}
		paths.add(path);
		offsets.push({
			offset: localOffset,
			hasDescriptor: (flags & 8) !== 0,
			dataEnd: localOffset + 30 + nameBytes + compressedSize,
		});
		offset = entryEnd;
	}
	if (offset !== centralEnd || paths.size !== entries.size) {
		throw archiveError("invalid_archive", "ZIP central directory count or size is invalid");
	}
	offsets.sort((left, right) => left.offset - right.offset);
	if (offsets[0]?.offset !== 0) {
		throw archiveError("invalid_archive", "ZIP first local entry offset is invalid");
	}
	for (const [index, entry] of offsets.entries()) {
		const boundary = offsets[index + 1]?.offset ?? centralOffset;
		const descriptorBytes = boundary - entry.dataEnd;
		if (
			entry.offset >= boundary ||
			(entry.hasDescriptor
				? descriptorBytes !== 12 && descriptorBytes !== 16
				: descriptorBytes !== 0)
		) {
			throw archiveError("invalid_archive", "ZIP local entry offsets or boundaries are invalid");
		}
	}
};

const extractArchive = Effect.fn(function* <E>(
	chunks: Stream.Stream<Uint8Array, E>,
	directory: string,
	fs: FileSystem.FileSystem,
	limits: V1ArchiveLimits,
) {
	const entries = new Map<string, ExtractedEntry>();
	const pendingWrites: Promise<unknown>[] = [];
	let totalBytes = 0;
	let archiveBytes = 0;
	let failure: BackupArchiveError | null = null;
	let entryCount = 0;
	const tail = new BoundedTail(
		limits.maxEntryCount * (ZIP_CENTRAL_HEADER_BYTES + MAX_ZIP_PATH_BYTES) +
			ZIP_EOCD_BYTES +
			ZIP_MAX_COMMENT_BYTES,
	);
	const unzip = new Unzip((file) => {
		entryCount += 1;
		const path = file.name;
		if (entryCount > limits.maxEntryCount) {
			failure = archiveError("entry_count_exceeded", "ZIP entry limit exceeded", path);
			return;
		}
		if (!validPath(path)) {
			failure = archiveError("invalid_path", "ZIP entry path is unsafe", path);
			return;
		}
		if (path.endsWith("/") || path.endsWith("\\")) {
			failure = archiveError("unexpected_path", "ZIP directories are not allowed", path);
			return;
		}
		if (!allowedPath(path)) {
			failure = archiveError("unexpected_path", "Unexpected ZIP entry", path);
			return;
		}
		if (entries.has(path)) {
			failure = archiveError("duplicate_path", "Duplicate ZIP entry path", path);
			return;
		}
		if (file.compression !== 0 && file.compression !== 8) {
			failure = archiveError("unsupported_compression", "Unsupported ZIP compression", path);
			return;
		}
		const isAsset = path.startsWith("assets/");
		const entryLimit = isAsset ? limits.maxEntryBytes : limits.maxMetadataEntryBytes;
		if (file.originalSize !== undefined && file.originalSize > entryLimit) {
			failure = archiveError("entry_too_large", "ZIP entry is too large", path);
			return;
		}
		const hash = new IncrementalSha256();
		const buffered: Uint8Array[] = [];
		const assetPath = isAsset ? `${directory}/${path.slice("assets/".length)}` : undefined;
		const writer = assetPath === undefined ? undefined : Bun.file(assetPath).writer();
		entries.set(path, {
			path,
			bytes: 0,
			sha256: "",
			compression: file.compression,
			chunks: buffered,
			...(assetPath ? { assetPath } : {}),
		});
		file.ondata = (error, data, final) => {
			if (failure !== null) {
				return;
			}
			if (error !== null) {
				failure = archiveError("invalid_archive", error.message, path);
				return;
			}
			hash.update(data);
			if (hash.bytes > entryLimit) {
				failure = archiveError("entry_too_large", "ZIP entry is too large", path);
				file.terminate();
				return;
			}
			totalBytes += data.byteLength;
			if (totalBytes > limits.maxTotalUncompressedBytes) {
				failure = archiveError("total_size_exceeded", "ZIP total size limit exceeded", path);
				file.terminate();
				return;
			}
			if (writer === undefined) {
				buffered.push(data.slice());
			} else {
				const write = writer.write(data);
				if (write instanceof Promise) {
					pendingWrites.push(write);
				}
			}
			if (final) {
				const completed = hash.digest();
				if (writer === undefined) {
					entries.set(path, {
						path,
						...completed,
						chunks: buffered,
						compression: file.compression,
					});
				} else if (assetPath === undefined) {
					failure = archiveError("invalid_archive", "Asset spool path is missing", path);
					return;
				} else {
					entries.set(path, { path, ...completed, assetPath, compression: file.compression });
				}
				const ended = writer?.end();
				if (ended instanceof Promise) {
					pendingWrites.push(ended);
				}
			}
		};
		file.start();
	});
	unzip.register(UnzipPassThrough);
	unzip.register(UnzipInflate);
	const flushWrites = () => {
		const writes = pendingWrites.splice(0);
		return writes.length === 0
			? Effect.void
			: Effect.tryPromise({
					try: () => Promise.all(writes).then(() => undefined),
					catch: () => archiveError("invalid_archive", "Could not spool backup asset"),
				});
	};
	const checkFailure = () => (failure === null ? Effect.void : Effect.fail(failure));
	yield* Stream.runForEach(chunks, (chunk) =>
		Effect.try({
			try: () => {
				archiveBytes += chunk.byteLength;
				tail.update(chunk);
				unzip.push(chunk);
			},
			catch: () => archiveError("invalid_archive", "Invalid ZIP archive"),
		}).pipe(
			Effect.andThen(Effect.suspend(flushWrites)),
			Effect.andThen(Effect.suspend(checkFailure)),
		),
	).pipe(
		Effect.mapError((error) =>
			error instanceof BackupArchiveError
				? error
				: archiveError("invalid_archive", "Could not read ZIP archive"),
		),
	);
	yield* Effect.try({
		try: () => unzip.push(new Uint8Array(0), true),
		catch: () => archiveError("invalid_archive", "Invalid or truncated ZIP archive"),
	});
	yield* flushWrites();
	yield* checkFailure();
	yield* Effect.try({
		try: () => validateZipStructure(tail.bytes(), archiveBytes, entries, limits),
		catch: (error) =>
			error instanceof BackupArchiveError
				? error
				: archiveError("invalid_archive", "ZIP structure validation failed"),
	});
	return yield* Effect.try({
		try: () => validateExtracted(entries, directory, fs, limits),
		catch: (error) =>
			error instanceof BackupArchiveError
				? error
				: archiveError("invalid_archive", "Backup archive validation failed"),
	});
});

export const validateV1ArchiveStream = Effect.fn(function* <E>(
	stream: Stream.Stream<Uint8Array, E>,
	overrides: Partial<V1ArchiveLimits> = {},
) {
	const fs = yield* FileSystem.FileSystem;
	const directory = yield* fs.makeTempDirectory({ prefix: "ryot-backup-v1-" });
	const limits = { ...V1_ARCHIVE_LIMITS, ...overrides };
	return yield* extractArchive(stream, directory, fs, limits).pipe(
		Effect.catch((error) =>
			fs
				.remove(directory, { recursive: true, force: true })
				.pipe(Effect.ignore, Effect.andThen(Effect.fail(error))),
		),
	);
});

export const validateV1Archive = Effect.fn(function* (
	chunks: AsyncIterable<Uint8Array>,
	overrides: Partial<V1ArchiveLimits> = {},
) {
	return yield* validateV1ArchiveStream(
		Stream.fromAsyncIterable(chunks, () =>
			archiveError("invalid_archive", "Could not read archive"),
		),
		overrides,
	);
});
