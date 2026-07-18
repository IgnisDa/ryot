import { BunFileSystem } from "@effect/platform-bun";
import { assert, expect, it } from "@effect/vitest";
import { ascending, column, document, field, rows, table } from "@ryot-app/ryotql";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, FileSystem, Schema, Stream } from "effect";
import { unzipSync, Zip, zipSync, ZipPassThrough } from "fflate";

import {
	createArchiveStream,
	validateArchive,
	zipChunks,
	type CreateArchiveInput,
} from "./archive";
import { BackupArchiveError } from "./error";
import {
	ArchiveEvent,
	ArchiveManifest,
	ARCHIVE_SECTION_PATHS,
	type ArchiveRecords,
} from "./schemas";
import { encodeNdjson, IncrementalSha256 } from "./streaming";

const timestamp = "2026-08-23T12:00:00.000Z";
const encoder = new TextEncoder();
const fixtureRoot = new URL(
	"../../../../../../packages/contract/src/modules/backups/fixtures/v1/",
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
const records: ArchiveRecords = {
	entities: [],
	integrations: [],
	relationships: [],
	privatePlugins: [],
	entityDependencies: [],
	notificationSubscriptions: [],
	profile: { image: null, preferences: {}, name: "Test User" },
	installations: [
		{
			config: {},
			sortOrder: 0,
			id: "installation-1",
			createdAt: timestamp,
			updatedAt: timestamp,
			disabledIntent: false,
			lifecycleIntent: "ready",
			homeSavedViewId: "view-1",
			configuredSecretPaths: [],
			packageKey: `system:fixture:${"a".repeat(64)}`,
		},
	],
	savedViews: [
		{
			id: "view-1",
			icon: "list",
			sortOrder: 0,
			kind: "custom",
			name: "Fixture",
			slug: "fixture",
			pluginKey: null,
			isBuiltin: false,
			isDisabled: false,
			createdAt: timestamp,
			updatedAt: timestamp,
			dataSources: savedViewQuery,
			settings: { heading: "Fixture" },
			renderer: { kind: "custom", rendererId: "renderer-1" },
		},
	],
	clientRenderers: [
		{
			id: "renderer-1",
			draftRevision: 2,
			createdAt: timestamp,
			updatedAt: timestamp,
			publishedRevision: 1,
			slug: "fixture-renderer",
			name: "Fixture renderer",
			publishedHash: "published-source-hash",
			draftDefinition: {
				pluginDependencies: [],
				entry: "client/page.tsx",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				files: [{ path: "client/page.tsx", content: "ZXhwb3J0IGRlZmF1bHQgMQo=" }],
			},
			publishedDefinition: {
				pluginDependencies: [],
				entry: "client/page.tsx",
				settingsSchema: { fields: {} },
				automaticEntityPresentations: false,
				files: [{ path: "client/page.tsx", content: "ZXhwb3J0IGRlZmF1bHQgMQo=" }],
			},
		},
	],
};

const input = (overrides: Partial<CreateArchiveInput> = {}): CreateArchiveInput => {
	const events = new IncrementalSha256().digest();
	return {
		records,
		assets: [],
		redactions: [],
		createdAt: timestamp,
		archiveId: "archive-1",
		appVersion: "backend-v1",
		events: { ...events, count: 0, chunks: [] },
		requiredPlugins: [{ slug: "fixture", version: "1.0.0", sourceHash: "a".repeat(64) }],
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
	archiveInput: CreateArchiveInput = input(),
	overrides: Parameters<typeof createArchiveStream>[1] = {},
) {
	return bytes(yield* Stream.runCollect(createArchiveStream(archiveInput, overrides)));
});

const asChunks = (value: Uint8Array) => Stream.toAsyncIterable(Stream.make(value));

const decodeManifest = (value: Uint8Array) =>
	Schema.decodeSync(Schema.fromJsonString(ArchiveManifest))(new TextDecoder().decode(value));

const encodeManifest = (manifest: ArchiveManifest) =>
	encoder.encode(`${stableStringify(Schema.encodeUnknownSync(ArchiveManifest)(manifest))}\n`);

const mutateArchive = Effect.fn(function* (
	archiveInput: CreateArchiveInput,
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
	options: Parameters<typeof validateArchive>[1] = {},
) {
	return yield* validateArchive(asChunks(value), options).pipe(
		Effect.scoped,
		Effect.provide(BunFileSystem.layer),
		Effect.flip,
	);
});

const event = (id = "event-1"): ArchiveEvent => ({
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

const eventsInput = (events: ReadonlyArray<ArchiveEvent>) => {
	const chunks = [...encodeNdjson(events, ArchiveEvent)];
	const hash = new IncrementalSha256();
	for (const chunk of chunks) {
		hash.update(chunk);
	}
	return { chunks, count: events.length, ...hash.digest() };
};

const entity = (): ArchiveRecords["entities"][number] => ({
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
				size: measured.bytes,
				sha256: measured.sha256,
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

const excludedAccountArchiveSections = [
	"automation-triggers.ndjson",
	"automation-trigger-recipients.ndjson",
	"automation-runs.ndjson",
	"automation-run-attempts.ndjson",
	"automation-artifacts.ndjson",
	"automation-retry-state.ndjson",
	"plugin-config-revisions.ndjson",
	"plugin-environment-config.ndjson",
	"plugin-config-encryption-key.json",
] as const;

it.effect("creates deterministic V1 archives and validates the round trip", () =>
	Effect.gen(function* () {
		const first = yield* archiveBytes();
		const second = yield* archiveBytes();
		expect(first).toEqual(second);
		const validated = yield* validateArchive(asChunks(first));
		expect(validated.manifest.version).toBe(1);
		expect(validated.records).toEqual(records);
	}).pipe(Effect.scoped, Effect.provide(BunFileSystem.layer)),
);

it.effect("excludes automation history and configuration revision sections", () =>
	Effect.gen(function* () {
		const files = unzipSync(yield* archiveBytes());
		const manifestFile = files["manifest.json"];
		assert(manifestFile);
		const sectionPaths = decodeManifest(manifestFile).sections.map(({ path }) => path);
		for (const path of excludedAccountArchiveSections) {
			expect(files).not.toHaveProperty(path);
			expect(sectionPaths).not.toContain(path);
		}
	}).pipe(Effect.provide(BunFileSystem.layer)),
);

it.effect("validates the V1 golden fixture", () =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const paths = ["manifest.json", ...ARCHIVE_SECTION_PATHS];
		const validated = yield* validateArchive(
			zipChunks(
				paths.map((path) => ({
					path,
					compression: "store" as const,
					chunks: Stream.toAsyncIterable(fs.stream(new URL(path, fixtureRoot).pathname)),
				})),
			),
		);
		expect(validated.manifest.archiveId).toBe("fixture-v1");
	}).pipe(Effect.scoped, Effect.provide(BunFileSystem.layer)),
);

it.effect("rejects a non-V1 manifest", () =>
	Effect.gen(function* () {
		const files = unzipSync(yield* archiveBytes());
		const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(ArchiveManifest))(
			new TextDecoder().decode(files["manifest.json"]),
		);
		files["manifest.json"] = new TextEncoder().encode(stableStringify({ ...manifest, version: 2 }));
		const error = yield* validateArchive(asChunks(zipSync(files))).pipe(Effect.scoped, Effect.flip);
		expect(error).toBeInstanceOf(BackupArchiveError);
		expect(error.reason).toBe("unsupported_format");
	}).pipe(Effect.provide(BunFileSystem.layer)),
);

it.effect("rejects unsafe ZIP paths", () =>
	Effect.gen(function* () {
		const error = yield* validateArchive(
			asChunks(zipSync({ "../manifest.json": new Uint8Array() })),
		).pipe(Effect.scoped, Effect.flip);
		expect(error).toBeInstanceOf(BackupArchiveError);
		expect(error.reason).toBe("invalid_path");
	}).pipe(Effect.provide(BunFileSystem.layer)),
);

it.effect("enforces record, entry, and total archive limits", () =>
	Effect.gen(function* () {
		const { asset } = assetInput();
		const archive = yield* archiveBytes(
			input({ assets: [asset], records: { ...records, entities: [entity()] } }),
		);
		const cases = [
			{ reason: "count_mismatch", limits: { maxRecordsPerSection: 0 } },
			{ limits: { maxEntryCount: 1 }, reason: "entry_count_exceeded" },
			{ reason: "entry_too_large", limits: { maxEntryBytes: 1 } },
			{ reason: "entry_too_large", limits: { maxMetadataEntryBytes: 1 } },
			{ reason: "total_size_exceeded", limits: { maxTotalUncompressedBytes: 1 } },
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
			events: eventsInput([event()]),
			records: { ...records, entities: [entity()] },
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
		yield* Effect.gen(function* () {
			const validated = yield* validateArchive(asChunks(eventCount));
			const error = yield* Stream.runDrain(validated.events.read()).pipe(Effect.flip);
			expect(error).toMatchObject({ path: "events.ndjson", reason: "count_mismatch" });
		}).pipe(Effect.scoped, Effect.provide(BunFileSystem.layer));
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
		for (const { reason, payload } of [
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
			yield* Effect.gen(function* () {
				const validated = yield* validateArchive(asChunks(streamed));
				const error = yield* Stream.runDrain(validated.events.read()).pipe(Effect.flip);
				expect(error).toMatchObject({ reason, path: "events.ndjson" });
			}).pipe(Effect.scoped, Effect.provide(BunFileSystem.layer));
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

it.effect("releases the spool directory on success, failure, and interruption", () =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const root = yield* fs.makeTempDirectory({ prefix: "ryot-backup-spool-test-" });
		const spooled = yield* archiveBytes(input({ records: { ...records, entities: [entity()] } }));
		const spoolEntries = () => fs.readDirectory(root).pipe(Effect.map((paths) => paths.length));

		const held = yield* Effect.gen(function* () {
			const validated = yield* validateArchive(asChunks(spooled), { directory: root });
			expect(yield* spoolEntries()).toBe(1);
			return validated.assets.length;
		}).pipe(Effect.scoped);
		expect(held).toBe(0);
		expect(yield* spoolEntries()).toBe(0);

		const truncated = yield* mutateArchive(input(), (files) => {
			replaceSection(files, "events.ndjson", encoder.encode('{"id":'));
		});
		yield* Effect.gen(function* () {
			const validated = yield* validateArchive(asChunks(truncated), { directory: root });
			return yield* Stream.runDrain(validated.events.read());
		}).pipe(Effect.scoped, Effect.flip);
		expect(yield* spoolEntries()).toBe(0);

		expect(
			(yield* validationError(rawZip(["manifest.json", "manifest.json"]), { directory: root }))
				.reason,
		).toBe("duplicate_path");
		expect(yield* spoolEntries()).toBe(0);

		const exit = yield* Effect.exit(
			Effect.gen(function* () {
				yield* validateArchive(asChunks(spooled), { directory: root });
				return yield* Effect.interrupt;
			}).pipe(Effect.scoped),
		);
		expect(exit._tag).toBe("Failure");
		expect(yield* spoolEntries()).toBe(0);

		yield* fs.remove(root, { force: true, recursive: true });
	}).pipe(Effect.provide(BunFileSystem.layer)),
);

it.effect("rejects noncanonical base64 private plugin files", () =>
	Effect.gen(function* () {
		const archive = yield* mutateArchive(input(), (files) => {
			replaceSection(
				files,
				"private-plugins.ndjson",
				encoder.encode(
					`${JSON.stringify({
						manifest: {},
						slug: "fixture",
						version: "1.0.0",
						sourceHash: "a".repeat(64),
						files: { "backend/main.ts": "Zg" },
						key: `user:fixture:${"a".repeat(64)}`,
					})}\n`,
				),
			);
		});
		const error = yield* validationError(archive);
		expect(error).toMatchObject({ reason: "invalid_entry", path: "private-plugins.ndjson" });
	}),
);
