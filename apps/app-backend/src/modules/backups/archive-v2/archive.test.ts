import { BunFileSystem } from "@effect/platform-bun";
import { assert, expect, it } from "@effect/vitest";
import { ascending, column, document, field, rows, table } from "@ryot/ryotql";
import { stableStringify } from "@ryot/ts-utils/json";
import { Effect, FileSystem, Schema, Stream } from "effect";
import { unzipSync, Zip, zipSync, ZipPassThrough } from "fflate";

import {
	createV2ArchiveStream,
	validateV2Archive,
	zipChunks,
	type CreateV2ArchiveInput,
} from "./archive";
import { BackupArchiveError } from "./error";
import { V2Event, V2Manifest, V2_SECTION_PATHS, type V2ArchiveRecords } from "./schemas";
import { encodeNdjson, IncrementalSha256 } from "./streaming";

const timestamp = "2026-08-23T12:00:00.000Z";
const encoder = new TextEncoder();
const fixtureRoot = new URL(
	"../../../../../../packages/contract/src/modules/backups/fixtures/v2/",
	import.meta.url,
);
const savedViewEntity = table("entity", "fixture");
const savedViewQuery = document({
	savedView: rows(savedViewEntity, {
		orderBy: [ascending(column(savedViewEntity, "name"))],
		fields: [
			field("id", column(savedViewEntity, "id")),
			field("name", column(savedViewEntity, "name")),
		],
	}),
});
const savedViewCard = {
	callout: null,
	overline: null,
	imageField: null,
	titleField: "name",
	entityIdField: "id",
	queryDocument: savedViewQuery,
	primaryMetadata: null,
	secondaryMetadata: null,
} as const;
const records: V2ArchiveRecords = {
	entities: [],
	savedViews: [
		{
			id: "view-1",
			icon: "list",
			name: "Fixture",
			slug: "fixture",
			pluginKey: null,
			sortOrder: 0,
			isBuiltin: false,
			isDisabled: false,
			kind: "custom",
			createdAt: timestamp,
			updatedAt: timestamp,
			entitySchemaSlug: null,
			entitySchemaPluginKey: null,
			layouts: {
				grid: savedViewCard,
				list: savedViewCard,
				table: {
					queryDocument: savedViewQuery,
					imageField: null,
					entityIdField: "id",
					columns: [{ label: "Name", field: "name", displayKind: "text" }],
				},
			},
		},
	],
	integrations: [],
	installations: [],
	relationships: [],
	privatePlugins: [],
	entityDependencies: [],
	notificationSubscriptions: [],
	profile: { image: null, name: "Test User", preferences: {} },
};

const input = (overrides: Partial<CreateV2ArchiveInput> = {}): CreateV2ArchiveInput => {
	const events = new IncrementalSha256().digest();
	return {
		records,
		assets: [],
		redactions: [],
		requiredPlugins: [],
		createdAt: timestamp,
		archiveId: "archive-1",
		appVersion: "backend-v2",
		events: { ...events, count: 0, chunks: [] },
		...overrides,
	};
};

const bytes = (chunks: Iterable<Uint8Array>) => {
	const values = [...chunks];
	const result = new Uint8Array(values.reduce((total, value) => total + value.byteLength, 0));
	let offset = 0;
	for (const value of values) {
		result.set(value, offset);
		offset += value.byteLength;
	}
	return result;
};

const archiveBytes = Effect.fn(function* (
	archiveInput: CreateV2ArchiveInput = input(),
	overrides: Parameters<typeof createV2ArchiveStream>[1] = {},
) {
	return bytes(yield* Stream.runCollect(createV2ArchiveStream(archiveInput, overrides)));
});

const asChunks = (value: Uint8Array) => Stream.toAsyncIterable(Stream.make(value));

const decodeManifest = (value: Uint8Array) =>
	Schema.decodeUnknownSync(Schema.fromJsonString(V2Manifest))(new TextDecoder().decode(value));

const encodeManifest = (manifest: V2Manifest) =>
	encoder.encode(`${stableStringify(Schema.encodeUnknownSync(V2Manifest)(manifest))}\n`);

const mutateArchive = Effect.fn(function* (
	archiveInput: CreateV2ArchiveInput,
	mutate: (files: Record<string, Uint8Array>) => void,
) {
	const files = unzipSync(yield* archiveBytes(archiveInput)) as Record<string, Uint8Array>;
	mutate(files);
	return zipSync(files);
});

const replaceSection = (files: Record<string, Uint8Array>, path: string, payload: Uint8Array) => {
	const manifestFile = files["manifest.json"];
	assert(manifestFile !== undefined);
	const manifest = decodeManifest(manifestFile);
	const hash = new IncrementalSha256();
	hash.update(payload);
	const sha256 = hash.digest().sha256;
	files[path] = payload;
	files["manifest.json"] = encodeManifest({
		...manifest,
		sections: manifest.sections.map((section) =>
			section.path === path ? Object.assign({}, section, { sha256 }) : section,
		),
	});
};

const validationError = Effect.fn(function* (
	value: Uint8Array,
	options: Parameters<typeof validateV2Archive>[1] = {},
) {
	return yield* validateV2Archive(asChunks(value), options).pipe(
		Effect.provide(BunFileSystem.layer),
		Effect.flip,
	);
});

const event = (id = "event-1"): V2Event => ({
	id,
	properties: {},
	entityId: "entity-1",
	createdAt: timestamp,
	updatedAt: timestamp,
	occurredAt: timestamp,
	sessionEntityId: null,
	eventSchemaSlug: "changed",
	eventSchemaPluginKey: null,
});

const eventsInput = (events: ReadonlyArray<V2Event>) => {
	const chunks = [...encodeNdjson(events, V2Event)];
	const hash = new IncrementalSha256();
	for (const chunk of chunks) {
		hash.update(chunk);
	}
	return { chunks, count: events.length, ...hash.digest() };
};

const entity = (): V2ArchiveRecords["entities"][number] => ({
	origin: null,
	id: "entity-1",
	name: "Entity",
	properties: {},
	provider: null,
	externalId: null,
	populatedAt: null,
	createdAt: timestamp,
	updatedAt: timestamp,
	entitySchemaSlug: "entity",
	entitySchemaPluginKey: null,
});

const assetInput = () => {
	const payload = encoder.encode("asset payload");
	const hash = new IncrementalSha256();
	hash.update(payload);
	const measured = hash.digest();
	return {
		payload,
		asset: {
			chunks: [payload],
			metadata: {
				sha256: measured.sha256,
				size: measured.bytes,
				contentType: "text/plain",
				path: `assets/${measured.sha256}`,
			},
		},
	};
};

const rawZip = (paths: ReadonlyArray<string>) => {
	const chunks: Uint8Array[] = [];
	const zip = new Zip((error, chunk) => {
		if (error !== null) {
			throw error;
		}
		chunks.push(chunk.slice());
	});
	for (const path of paths) {
		const file = new ZipPassThrough(path);
		zip.add(file);
		file.push(encoder.encode("value"), true);
	}
	zip.end();
	return bytes(chunks);
};

it.effect("creates deterministic V2 archives and validates the round trip", () =>
	Effect.gen(function* () {
		const first = yield* archiveBytes();
		const second = yield* archiveBytes();
		expect(first).toEqual(second);
		const validated = yield* validateV2Archive(asChunks(first));
		expect(validated.manifest.version).toBe(2);
		expect(validated.records).toEqual(records);
		yield* validated.cleanup;
	}).pipe(Effect.provide(BunFileSystem.layer)),
);

it.effect("encodes and retains entity creation origin", () =>
	Effect.gen(function* () {
		const origin = { kind: "bootstrap" as const };
		const archive = yield* archiveBytes({
			...input(),
			records: { ...records, entities: [{ ...entity(), origin }] },
		});
		const validated = yield* validateV2Archive(asChunks(archive));
		expect(validated.records.entities[0]?.origin).toEqual(origin);
		yield* validated.cleanup;
	}).pipe(Effect.provide(BunFileSystem.layer)),
);

it.effect("validates the V2 golden fixture", () =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const paths = ["manifest.json", ...V2_SECTION_PATHS];
		const validated = yield* validateV2Archive(
			zipChunks(
				paths.map((path) => ({
					path,
					compression: "store" as const,
					chunks: Stream.toAsyncIterable(fs.stream(new URL(path, fixtureRoot).pathname)),
				})),
			),
		);
		expect(validated.manifest.archiveId).toBe("fixture-v2");
		yield* validated.cleanup;
	}).pipe(Effect.provide(BunFileSystem.layer)),
);

it.effect("rejects every manifest version other than V2", () =>
	Effect.gen(function* () {
		const files = unzipSync(yield* archiveBytes());
		const manifest = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(V2Manifest))(
			new TextDecoder().decode(files["manifest.json"]),
		);
		files["manifest.json"] = new TextEncoder().encode(stableStringify({ ...manifest, version: 1 }));
		const error = yield* validateV2Archive(asChunks(zipSync(files))).pipe(Effect.flip);
		expect(error).toBeInstanceOf(BackupArchiveError);
		expect(error.reason).toBe("unsupported_format");
	}).pipe(Effect.provide(BunFileSystem.layer)),
);

it.effect("rejects unsafe ZIP paths", () =>
	Effect.gen(function* () {
		const error = yield* validateV2Archive(
			asChunks(zipSync({ "../manifest.json": new Uint8Array() })),
		).pipe(Effect.flip);
		expect(error).toBeInstanceOf(BackupArchiveError);
		expect(error.reason).toBe("invalid_path");
	}).pipe(Effect.provide(BunFileSystem.layer)),
);

it.effect("enforces record, entry, and total archive limits", () =>
	Effect.gen(function* () {
		const { asset } = assetInput();
		const archive = yield* archiveBytes(
			input({ records: { ...records, entities: [entity()] }, assets: [asset] }),
		);
		const cases = [
			{ limits: { maxRecordsPerSection: 0 }, reason: "count_mismatch" },
			{ limits: { maxEntryCount: 1 }, reason: "entry_count_exceeded" },
			{ limits: { maxEntryBytes: 1 }, reason: "entry_too_large" },
			{ limits: { maxMetadataEntryBytes: 1 }, reason: "entry_too_large" },
			{ limits: { maxTotalUncompressedBytes: 1 }, reason: "total_size_exceeded" },
		] as const;
		for (const testCase of cases) {
			const error = yield* validationError(archive, { limits: testCase.limits });
			expect(error.reason).toBe(testCase.reason);
		}
	}),
);

it.effect("rejects section digest and count mismatches including streamed events", () =>
	Effect.gen(function* () {
		const populated = input({
			records: { ...records, entities: [entity()] },
			events: eventsInput([event()]),
		});
		const boundedDigest = yield* mutateArchive(populated, (files) => {
			files["entities.ndjson"] = encoder.encode("\n");
		});
		expect((yield* validationError(boundedDigest)).reason).toBe("checksum_mismatch");

		const eventDigest = yield* mutateArchive(populated, (files) => {
			files["events.ndjson"] = encoder.encode("\n");
		});
		expect((yield* validationError(eventDigest)).reason).toBe("checksum_mismatch");

		const boundedCount = yield* mutateArchive(populated, (files) => {
			const manifestFile = files["manifest.json"];
			assert(manifestFile !== undefined);
			const manifest = decodeManifest(manifestFile);
			files["manifest.json"] = encodeManifest({
				...manifest,
				sections: manifest.sections.map((section) =>
					section.path === "entities.ndjson" ? Object.assign({}, section, { count: 2 }) : section,
				),
			});
		});
		expect((yield* validationError(boundedCount)).reason).toBe("count_mismatch");

		const eventCount = yield* mutateArchive(populated, (files) => {
			const manifestFile = files["manifest.json"];
			assert(manifestFile !== undefined);
			const manifest = decodeManifest(manifestFile);
			files["manifest.json"] = encodeManifest({
				...manifest,
				sections: manifest.sections.map((section) =>
					section.path === "events.ndjson" ? Object.assign({}, section, { count: 2 }) : section,
				),
			});
		});
		const validated = yield* validateV2Archive(asChunks(eventCount)).pipe(
			Effect.provide(BunFileSystem.layer),
		);
		const error = yield* Stream.runDrain(validated.events.read()).pipe(Effect.flip);
		expect(error).toMatchObject({ reason: "count_mismatch", path: "events.ndjson" });
		yield* validated.cleanup;
	}),
);

it.effect("rejects duplicate and missing paths and unsupported compression", () =>
	Effect.gen(function* () {
		expect((yield* validationError(rawZip(["manifest.json", "manifest.json"]))).reason).toBe(
			"duplicate_path",
		);
		const missing = yield* mutateArchive(input(), (files) => {
			Reflect.deleteProperty(files, "entities.ndjson");
		});
		expect((yield* validationError(missing)).reason).toBe("missing_entry");

		const unsupported = (yield* archiveBytes()).slice();
		const view = new DataView(unsupported.buffer, unsupported.byteOffset, unsupported.byteLength);
		for (let offset = 0; offset <= unsupported.byteLength - 12; offset += 1) {
			const signature = view.getUint32(offset, true);
			if (signature === 0x04034b50) {
				view.setUint16(offset + 8, 99, true);
			} else if (signature === 0x02014b50) {
				view.setUint16(offset + 10, 99, true);
			}
		}
		expect((yield* validationError(unsupported)).reason).toBe("unsupported_compression");
	}),
);

it.effect("rejects malformed and truncated bounded and streamed NDJSON", () =>
	Effect.gen(function* () {
		for (const { payload, reason } of [
			{ payload: "not-json\n", reason: "invalid_entry" },
			{ payload: '{"id":', reason: "truncated_ndjson" },
		] as const) {
			const bounded = yield* mutateArchive(input(), (files) => {
				replaceSection(files, "entities.ndjson", encoder.encode(payload));
			});
			expect((yield* validationError(bounded)).reason).toBe(reason);

			const streamed = yield* mutateArchive(input(), (files) => {
				replaceSection(files, "events.ndjson", encoder.encode(payload));
			});
			const validated = yield* validateV2Archive(asChunks(streamed)).pipe(
				Effect.provide(BunFileSystem.layer),
			);
			const error = yield* Stream.runDrain(validated.events.read()).pipe(Effect.flip);
			expect(error).toMatchObject({ reason, path: "events.ndjson" });
			yield* validated.cleanup;
		}
	}),
);

it.effect("rejects undeclared, missing, and mismatched assets", () =>
	Effect.gen(function* () {
		const { asset } = assetInput();
		const archiveInput = input({ assets: [asset] });
		const undeclared = yield* mutateArchive(archiveInput, (files) => {
			files[`assets/${"a".repeat(64)}`] = encoder.encode("undeclared");
		});
		expect((yield* validationError(undeclared)).reason).toBe("undeclared_asset");

		const missing = yield* mutateArchive(archiveInput, (files) => {
			Reflect.deleteProperty(files, asset.metadata.path);
		});
		expect((yield* validationError(missing)).reason).toBe("missing_entry");

		const digest = yield* mutateArchive(archiveInput, (files) => {
			files[asset.metadata.path] = encoder.encode("changed asset");
		});
		expect((yield* validationError(digest)).reason).toBe("checksum_mismatch");

		const size = yield* mutateArchive(archiveInput, (files) => {
			const manifestFile = files["manifest.json"];
			assert(manifestFile !== undefined);
			const manifest = decodeManifest(manifestFile);
			files["manifest.json"] = encodeManifest({
				...manifest,
				assets: manifest.assets.map((item) => Object.assign({}, item, { size: item.size + 1 })),
			});
		});
		expect((yield* validationError(size)).reason).toBe("checksum_mismatch");
	}),
);
