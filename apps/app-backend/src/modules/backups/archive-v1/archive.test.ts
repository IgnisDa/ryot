import { BunFileSystem } from "@effect/platform-bun";
import { assert, describe, expect, it } from "@effect/vitest";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { Effect, FileSystem, Schema, Stream } from "effect";
import { Zip, zipSync, unzipSync, ZipPassThrough } from "fflate";

import {
	createV1ArchiveStream,
	sortV1ArchiveRecords,
	validateV1Archive,
	validateV1ArchiveStream,
	zipChunks,
	type V1_ARCHIVE_LIMITS,
	type CreateV1ArchiveInput,
} from "./archive";
import { BackupArchiveError } from "./error";
import { redactV1SchemaSecrets } from "./references";
import {
	V1Event,
	V1Manifest,
	V1Profile,
	V1EntityDependency,
	V1_SECTION_PATHS,
	type V1ArchiveRecords,
} from "./schemas";
import { encodeNdjson, IncrementalSha256 } from "./streaming";

const timestamp = "2026-08-23T12:00:00.000Z";
const encoder = new TextEncoder();
const decodeManifest = (bytes: Uint8Array) =>
	Schema.decodeUnknownSync(Schema.fromJsonString(V1Manifest))(new TextDecoder().decode(bytes));
const decodeProfile = (bytes: Uint8Array) =>
	Schema.decodeUnknownSync(Schema.fromJsonString(V1Profile))(new TextDecoder().decode(bytes));

const fixtureRoot = new URL(
	"../../../../../../packages/contract/src/modules/backups/fixtures/v1/",
	import.meta.url,
);
const fixturePaths = ["manifest.json", ...V1_SECTION_PATHS] as const;

const fixtureArchive = (fs: FileSystem.FileSystem) =>
	zipChunks(
		fixturePaths.map((path) => ({
			chunks: Stream.toAsyncIterable(fs.stream(new URL(path, fixtureRoot).pathname)),
			compression: "store" as const,
			path,
		})),
	);

const concat = (chunks: Iterable<Uint8Array>) => {
	const values = [...chunks];
	const output = new Uint8Array(values.reduce((size, chunk) => size + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of values) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
};

const emptyRecords = (): V1ArchiveRecords => ({
	entities: [],
	savedViews: [],
	pluginState: [],
	relationships: [],
	entityDependencies: [],
	notificationSubscriptions: [],
	profile: { image: null, name: "Test User", preferences: { locale: "en" } },
});

const event = (id: string): V1Event => ({
	id,
	properties: {},
	entityId: "entity-1",
	createdAt: timestamp,
	updatedAt: timestamp,
	occurredAt: timestamp,
	sessionEntityId: null,
	eventSchemaSlug: "review",
});

const eventsInput = (records: ReadonlyArray<V1Event> = []) => {
	const chunks = [...encodeNdjson(records, V1Event)];
	const hash = new IncrementalSha256();
	for (const chunk of chunks) {
		hash.update(chunk);
	}
	return { chunks, count: records.length, ...hash.digest() };
};

const archiveInput = (records = emptyRecords(), events = eventsInput()): CreateV1ArchiveInput => {
	const asset = encoder.encode("streamed asset bytes");
	const hash = new IncrementalSha256();
	hash.update(asset);
	const measured = hash.digest();
	return {
		events,
		records,
		appVersion: "1.2.3",
		createdAt: timestamp,
		archiveId: "archive-1",
		redactions: ["/plugin-state/media/config/token"],
		requiredPlugins: [
			{ slug: "z-plugin", version: "2.0.0" },
			{ slug: "a-plugin", version: "1.0.0" },
		],
		assets: [
			{
				chunks: [asset.slice(0, 5), asset.slice(5)],
				metadata: {
					size: measured.bytes,
					sha256: measured.sha256,
					contentType: "text/plain",
					path: `assets/${measured.sha256}`,
				},
			},
		],
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
	return chunks;
};

const mutateArchive = Effect.fn(function* (
	input: CreateV1ArchiveInput,
	mutate: (files: Record<string, Uint8Array>) => void,
) {
	const chunks = yield* Stream.runCollect(createV1ArchiveStream(input));
	const files = unzipSync(concat(chunks)) as Record<string, Uint8Array>;
	mutate(files);
	return zipSync(files);
});

const replaceSection = (files: Record<string, Uint8Array>, path: string, bytes: Uint8Array) => {
	const manifestFile = files["manifest.json"];
	assert(manifestFile !== undefined);
	const manifest = decodeManifest(manifestFile);
	const hash = new IncrementalSha256();
	hash.update(bytes);
	files[path] = bytes;
	files["manifest.json"] = encoder.encode(
		`${JSON.stringify({
			...manifest,
			sections: manifest.sections.map((section) =>
				section.path === path
					? Object.assign({}, section, { sha256: hash.digest().sha256 })
					: section,
			),
		})}\n`,
	);
};

const validationError = Effect.fn(function* <E>(stream: Stream.Stream<Uint8Array, E>) {
	return yield* validateV1ArchiveStream(stream).pipe(
		Effect.provide(BunFileSystem.layer),
		Effect.flip,
	);
});

const creationError = Effect.fn(function* (
	input: CreateV1ArchiveInput,
	overrides: Partial<Record<keyof typeof V1_ARCHIVE_LIMITS, number>> = {},
) {
	return yield* Stream.runDrain(createV1ArchiveStream(input, overrides)).pipe(Effect.flip);
});

const dependency = (
	id: string,
	translations: V1ArchiveRecords["entityDependencies"][number]["translations"],
) => ({
	id,
	translations,
	properties: {},
	provider: null,
	externalId: null,
	populatedAt: null,
	name: "Dependency",
	createdAt: timestamp,
	updatedAt: timestamp,
	entitySchemaSlug: "collection",
	identity: { kind: "unmanaged" as const },
});

const translation = (id: string, language: string) => ({
	id,
	language,
	name: null,
	properties: null,
	populatedAt: null,
	createdAt: timestamp,
	updatedAt: timestamp,
});

describe("V1 streaming ZIP validation", () => {
	it.effect("validates the checked-in V1 golden archive fixture", () =>
		Effect.gen(function* () {
			const validated = yield* Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				return yield* validateV1Archive(fixtureArchive(fs));
			}).pipe(Effect.provide(BunFileSystem.layer));
			expect(validated.manifest).toMatchObject({
				version: 1,
				createdAt: timestamp,
				format: "ryot-backup",
				appVersion: "v1-minimal-golden",
				archiveId: "00000000-0000-4000-8000-000000000002",
				redactions: [],
				requiredPlugins: [{ slug: "media", version: "1.0.0" }],
			});
			expect(validated.manifest.sections).toEqual([
				{
					count: 1,
					path: "profile.json",
					sha256: "eea466674d173b8330508f0159ec8b8cd1c97303962cd4e3c03e918ace5f1128",
				},
				{
					count: 0,
					path: "plugin-state.ndjson",
					sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
				},
				{
					count: 1,
					path: "entities.ndjson",
					sha256: "160efb5d2a58d1aeb0d209a28ac56ce1f333f970efc6a120058c473b4db0386d",
				},
				{
					count: 0,
					path: "entity-dependencies.ndjson",
					sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
				},
				{
					count: 0,
					path: "relationships.ndjson",
					sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
				},
				{
					count: 0,
					path: "events.ndjson",
					sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
				},
				{
					count: 0,
					path: "saved-views.ndjson",
					sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
				},
				{
					count: 0,
					path: "notification-subscriptions.ndjson",
					sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
				},
			]);
			expect(validated.manifest.assets).toEqual([]);
			expect(validated.records.profile).toEqual({
				name: "Golden Archive User",
				image: null,
				preferences: { language: "fr", allowNsfw: true, disableIntegrations: true },
			});
			expect(validated.records.pluginState).toEqual([]);
			expect(validated.records.entities).toEqual([
				{
					provider: null,
					properties: {},
					name: "Library",
					externalId: null,
					populatedAt: null,
					createdAt: timestamp,
					updatedAt: timestamp,
					entitySchemaSlug: "library",
					id: "00000000-0000-4000-8000-000000000001",
				},
			]);
			expect(validated.records.entityDependencies).toEqual([]);
			expect(validated.records.relationships).toEqual([]);
			expect(validated.events.count).toBe(0);
			expect(yield* Stream.runCollect(validated.events.read())).toEqual([]);
			expect(validated.records.savedViews).toEqual([]);
			expect(validated.records.notificationSubscriptions).toEqual([]);
			expect(validated.assets).toEqual([]);
			yield* validated.cleanup;
		}),
	);

	it.effect("round trips the checked-in V1 fixture without changing its records", () =>
		Effect.gen(function* () {
			const validated = yield* Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				return yield* validateV1Archive(fixtureArchive(fs));
			}).pipe(Effect.provide(BunFileSystem.layer));
			const archivedEvents = yield* Stream.runCollect(validated.events.read());
			const roundTripped = yield* validateV1ArchiveStream(
				createV1ArchiveStream({
					assets: [],
					records: validated.records,
					archiveId: validated.manifest.archiveId,
					createdAt: validated.manifest.createdAt,
					appVersion: validated.manifest.appVersion,
					redactions: validated.manifest.redactions,
					events: eventsInput(archivedEvents),
					requiredPlugins: validated.manifest.requiredPlugins,
				}),
			).pipe(Effect.provide(BunFileSystem.layer));
			expect(roundTripped.records).toEqual(validated.records);
			expect(yield* Stream.runCollect(roundTripped.events.read())).toEqual(archivedEvents);
			expect(roundTripped.manifest).toMatchObject({
				version: 1,
				format: "ryot-backup",
				archiveId: validated.manifest.archiveId,
			});
			yield* roundTripped.cleanup;
			yield* validated.cleanup;
		}),
	);

	it.effect("round trips records and spools asset bytes", () =>
		Effect.gen(function* () {
			const validated = yield* validateV1ArchiveStream(createV1ArchiveStream(archiveInput())).pipe(
				Effect.provide(BunFileSystem.layer),
			);
			expect(validated.manifest).toMatchObject({
				version: 1,
				appVersion: "1.2.3",
				format: "ryot-backup",
				archiveId: "archive-1",
				requiredPlugins: [
					{ slug: "a-plugin", version: "1.0.0" },
					{ slug: "z-plugin", version: "2.0.0" },
				],
			});
			expect(validated.records.profile).toEqual({
				image: null,
				name: "Test User",
				preferences: { locale: "en" },
			});
			expect(validated.assets).toHaveLength(1);
			const asset = validated.assets[0];
			assert(asset !== undefined);
			const bytes = yield* Stream.runCollect(asset.stream);
			expect(new TextDecoder().decode(concat(bytes))).toBe("streamed asset bytes");
			yield* validated.cleanup;
		}),
	);

	it.effect("serializes only portable profile and exact manifest fields", () =>
		Effect.gen(function* () {
			const schema: AppSchema = {
				fields: {
					note: { type: "string", label: "Note", description: "Note" },
					token: { secret: true, type: "string", label: "Token", description: "Token" },
				},
			};
			const sourceConfig = { token: "two-factor-secret", note: "ordinary user text must remain" };
			const redacted = redactV1SchemaSecrets(sourceConfig, schema, "/plugin-state/plugin-1/config");
			const records = emptyRecords();
			const input = archiveInput({
				...records,
				pluginState: [
					{
						sortOrder: 0,
						id: "plugin-1",
						isDisabled: false,
						createdAt: timestamp,
						updatedAt: timestamp,
						pluginSlug: "a-plugin",
						config: redacted.redacted,
					},
				],
			});
			const archiveBytes = concat(
				yield* Stream.runCollect(
					createV1ArchiveStream({ ...input, redactions: redacted.redactions }),
				),
			);
			const files = unzipSync(archiveBytes) as Record<string, Uint8Array>;
			const serializedEntries = new TextDecoder().decode(concat(Object.values(files)));
			expect(serializedEntries).not.toContain(sourceConfig.token);
			expect(serializedEntries).toContain(sourceConfig.note);
			const manifestFile = files["manifest.json"];
			const profileFile = files["profile.json"];
			assert(manifestFile !== undefined);
			assert(profileFile !== undefined);
			const manifest = decodeManifest(manifestFile);
			expect(Object.keys(manifest)).toEqual([
				"format",
				"version",
				"archiveId",
				"appVersion",
				"createdAt",
				"sections",
				"assets",
				"requiredPlugins",
				"redactions",
			]);
			expect(manifest.sections.map((section) => section.path)).toEqual([...V1_SECTION_PATHS]);
			expect(Object.keys(manifest.sections[0] ?? {})).toEqual(["path", "count", "sha256"]);
			expect(Object.keys(manifest.assets[0] ?? {})).toEqual([
				"path",
				"size",
				"sha256",
				"contentType",
			]);
			expect(Object.keys(manifest.requiredPlugins[0] ?? {})).toEqual(["slug", "version"]);
			expect(Object.keys(decodeProfile(profileFile))).toEqual(["name", "image", "preferences"]);
		}),
	);

	it.effect("rejects duplicate required plugin slugs when creating an archive", () =>
		Effect.gen(function* () {
			const input = archiveInput();
			const error = yield* creationError({
				...input,
				requiredPlugins: [...input.requiredPlugins, { slug: "a-plugin", version: "2.0.0" }],
			});
			expect(error.message).toContain("Duplicate required plugin slug 'a-plugin'");
		}),
	);

	it.effect("rejects missing ZIP structures, truncated payloads, and trailing bytes", () =>
		Effect.gen(function* () {
			const archive = concat(yield* Stream.runCollect(createV1ArchiveStream(archiveInput())));
			const eocd = archive.byteLength - 22;
			const centralOffset = new DataView(archive.buffer, archive.byteOffset + eocd, 22).getUint32(
				16,
				true,
			);
			const withoutEocd = archive.slice(0, eocd);
			const withoutCentral = concat([archive.slice(0, centralOffset), archive.slice(eocd)]);
			const truncatedPayload = concat([
				archive.slice(0, centralOffset - 1),
				archive.slice(centralOffset),
			]);
			const trailingBytes = concat([archive, encoder.encode("trailing")]);
			for (const malformed of [withoutEocd, withoutCentral, truncatedPayload, trailingBytes]) {
				const error = yield* validationError(Stream.make(malformed));
				expect(error.reason).toBe("invalid_archive");
			}
		}),
	);

	it.effect("rejects multidisk and Zip64 EOCD markers", () =>
		Effect.gen(function* () {
			const archive = concat(yield* Stream.runCollect(createV1ArchiveStream(archiveInput())));
			const eocd = archive.byteLength - 22;
			const multidisk = archive.slice();
			new DataView(multidisk.buffer, multidisk.byteOffset + eocd, 22).setUint16(4, 1, true);
			const zip64 = archive.slice();
			const zip64Eocd = new DataView(zip64.buffer, zip64.byteOffset + eocd, 22);
			zip64Eocd.setUint16(8, 0xffff, true);
			zip64Eocd.setUint16(10, 0xffff, true);
			for (const malformed of [multidisk, zip64]) {
				const error = yield* validationError(Stream.make(malformed));
				expect(error.reason).toBe("unsupported_format");
			}
		}),
	);

	it.effect("rejects traversal and absolute paths", () =>
		Effect.gen(function* () {
			for (const path of ["../manifest.json", "/manifest.json", "C:/manifest.json"]) {
				const error = yield* validationError(Stream.fromIterable(rawZip([path])));
				expect(error.reason).toBe("invalid_path");
			}
		}),
	);

	it.effect("rejects duplicate ZIP paths", () =>
		Effect.gen(function* () {
			const error = yield* validationError(
				Stream.fromIterable(rawZip(["manifest.json", "manifest.json"])),
			);
			expect(error.reason).toBe("duplicate_path");
		}),
	);

	it.effect("rejects invalid manifest sections and required plugin slugs", () =>
		Effect.gen(function* () {
			const missingSectionArchive = yield* mutateArchive(archiveInput(), (files) => {
				const manifestFile = files["manifest.json"];
				assert(manifestFile !== undefined);
				const manifest = decodeManifest(manifestFile);
				files["manifest.json"] = encoder.encode(
					`${JSON.stringify({ ...manifest, sections: manifest.sections.slice(0, -1) })}\n`,
				);
			});
			const missingSectionError = yield* validationError(Stream.make(missingSectionArchive));
			expect(missingSectionError.reason).toBe("missing_entry");

			const duplicateSectionArchive = yield* mutateArchive(archiveInput(), (files) => {
				const manifestFile = files["manifest.json"];
				assert(manifestFile !== undefined);
				const manifest = decodeManifest(manifestFile);
				files["manifest.json"] = encoder.encode(
					`${JSON.stringify({
						...manifest,
						sections: manifest.sections.map((section, index) =>
							index === 1 ? manifest.sections[0] : section,
						),
					})}\n`,
				);
			});
			const duplicateSectionError = yield* validationError(Stream.make(duplicateSectionArchive));
			expect(duplicateSectionError.reason).toBe("duplicate_path");

			const duplicatePluginArchive = yield* mutateArchive(archiveInput(), (files) => {
				const manifestFile = files["manifest.json"];
				assert(manifestFile !== undefined);
				const manifest = decodeManifest(manifestFile);
				const plugin = manifest.requiredPlugins[0];
				assert(plugin !== undefined);
				files["manifest.json"] = encoder.encode(
					`${JSON.stringify({
						...manifest,
						requiredPlugins: [...manifest.requiredPlugins, plugin],
					})}\n`,
				);
			});
			const duplicatePluginError = yield* validationError(Stream.make(duplicatePluginArchive));
			expect(duplicatePluginError.reason).toBe("duplicate_record_id");
		}),
	);

	it.effect("rejects checksum and count mismatches", () =>
		Effect.gen(function* () {
			const checksumArchive = yield* mutateArchive(archiveInput(), (files) => {
				files["events.ndjson"] = encoder.encode('{"id":"unexpected"}\n');
			});
			const checksumError = yield* validationError(Stream.make(checksumArchive));
			expect(checksumError.reason).toBe("checksum_mismatch");
			const assetChecksumArchive = yield* mutateArchive(archiveInput(), (files) => {
				const assetPath = Object.keys(files).find((path) => path.startsWith("assets/"));
				assert(assetPath !== undefined);
				files[assetPath] = encoder.encode("corrupted asset");
			});
			const assetChecksumError = yield* validationError(Stream.make(assetChecksumArchive));
			expect(assetChecksumError.reason).toBe("checksum_mismatch");

			const countArchive = yield* mutateArchive(archiveInput(), (files) => {
				const manifestFile = files["manifest.json"];
				assert(manifestFile !== undefined);
				const manifest = decodeManifest(manifestFile);
				const entities = manifest.sections.findIndex(
					(section) => section.path === "entities.ndjson",
				);
				assert(entities >= 0);
				files["manifest.json"] = encoder.encode(
					`${JSON.stringify({
						...manifest,
						sections: manifest.sections.map((section, index) =>
							index === entities ? Object.assign({}, section, { count: 1 }) : section,
						),
					})}\n`,
				);
			});
			const countError = yield* validationError(Stream.make(countArchive));
			expect(countError.reason).toBe("count_mismatch");
		}),
	);

	it.effect("reports a spooled events count mismatch when the section is read", () =>
		Effect.gen(function* () {
			const archive = yield* mutateArchive(
				archiveInput(emptyRecords(), eventsInput([event("event-1")])),
				(files) => {
					const manifestFile = files["manifest.json"];
					assert(manifestFile !== undefined);
					const manifest = decodeManifest(manifestFile);
					files["manifest.json"] = encoder.encode(
						`${JSON.stringify({
							...manifest,
							sections: manifest.sections.map((section) =>
								section.path === "events.ndjson"
									? Object.assign({}, section, { count: 2 })
									: section,
							),
						})}\n`,
					);
				},
			);
			const validated = yield* validateV1ArchiveStream(Stream.make(archive)).pipe(
				Effect.provide(BunFileSystem.layer),
			);
			const error = yield* Stream.runDrain(validated.events.read()).pipe(Effect.flip);
			expect(error).toMatchObject({ reason: "count_mismatch", path: "events.ndjson" });
			yield* validated.cleanup;
		}),
	);

	it.effect("rejects undeclared assets", () =>
		Effect.gen(function* () {
			const archive = yield* mutateArchive(archiveInput(), (files) => {
				files[`assets/${"a".repeat(64)}`] = encoder.encode("undeclared");
			});
			const error = yield* validationError(Stream.make(archive));
			expect(error.reason).toBe("undeclared_asset");
		}),
	);

	it.effect("rejects duplicate record IDs while creating an archive", () =>
		Effect.gen(function* () {
			const duplicate = {
				id: "entity-1",
				name: "Entity",
				properties: {},
				provider: null,
				externalId: null,
				populatedAt: null,
				createdAt: timestamp,
				updatedAt: timestamp,
				entitySchemaSlug: "collection",
			} as const;
			const records = emptyRecords();
			const error = yield* creationError(
				archiveInput({ ...records, entities: [duplicate, { ...duplicate }] }),
			);
			expect(error.message).toContain("Duplicate record id 'entity-1'");
		}),
	);

	it.effect("enforces creation limits and preserves already sorted arrays", () =>
		Effect.gen(function* () {
			const records = emptyRecords();
			const sorted = sortV1ArchiveRecords(records);
			expect(sorted.entities).toBe(records.entities);
			expect(sorted.entityDependencies).toBe(records.entityDependencies);
			expect(sorted.notificationSubscriptions).toBe(records.notificationSubscriptions);
			expect((yield* creationError(archiveInput(), { maxEntryCount: 1 })).message).toContain(
				"ZIP entry limit exceeded",
			);
			expect(
				(yield* creationError(archiveInput(), { maxMetadataEntryBytes: 1 })).message,
			).toContain("ZIP entry is too large");
			expect((yield* creationError(archiveInput(), { maxEntryBytes: 1 })).message).toContain(
				"ZIP entry is too large",
			);
			expect(
				(yield* creationError(archiveInput(), { maxTotalUncompressedBytes: 1 })).message,
			).toContain("ZIP total size limit exceeded");
			const overLimit = yield* creationError(
				archiveInput({
					...records,
					entities: [
						{
							id: "entity-1",
							name: "Entity",
							properties: {},
							provider: null,
							externalId: null,
							populatedAt: null,
							createdAt: timestamp,
							updatedAt: timestamp,
							entitySchemaSlug: "collection",
						},
					],
				}),
				{ maxRecordsPerSection: 0 },
			);
			expect(overLimit).toMatchObject({
				path: "entities.ndjson",
				message: "Section record limit exceeded",
			});
		}),
	);

	it.effect("exempts the streamed events section from the bounded section record limit", () =>
		Effect.gen(function* () {
			const events = Array.from({ length: 64 }, (_, index) =>
				event(`event-${index.toString().padStart(4, "0")}`),
			);
			const validated = yield* validateV1ArchiveStream(
				createV1ArchiveStream(archiveInput(emptyRecords(), eventsInput(events)), {
					maxRecordsPerSection: 1,
				}),
				{ limits: { maxRecordsPerSection: 1 } },
			).pipe(Effect.provide(BunFileSystem.layer));
			expect(validated.events.count).toBe(events.length);
			expect(yield* Stream.runCollect(validated.events.read())).toEqual(events);
			yield* validated.cleanup;
		}),
	);

	it.effect("rejects an event stream that differs from its manifest metadata", () =>
		Effect.gen(function* () {
			const declared = eventsInput([event("event-1")]);
			const error = yield* creationError(
				archiveInput(emptyRecords(), { ...declared, chunks: [...encodeNdjson([], V1Event)] }),
			);
			expect(error).toMatchObject({ reason: "checksum_mismatch", path: "events.ndjson" });
		}),
	);

	it.effect("rejects global translation IDs and per-dependency languages while creating", () =>
		Effect.gen(function* () {
			const records = emptyRecords();
			const duplicateId = yield* creationError(
				archiveInput({
					...records,
					entityDependencies: [
						dependency("one", [translation("translation", "en")]),
						dependency("two", [translation("translation", "fr")]),
					],
				}),
			);
			expect(duplicateId.message).toContain("Duplicate translation id 'translation'");
			const duplicateLanguage = yield* creationError(
				archiveInput({
					...records,
					entityDependencies: [
						dependency("one", [translation("one", "en"), translation("two", "en")]),
					],
				}),
			);
			expect(duplicateLanguage.message).toContain("Duplicate translation language 'en'");
		}),
	);

	it.effect("rejects duplicate translation IDs and languages during validation", () =>
		Effect.gen(function* () {
			const records = emptyRecords();
			const duplicateIdArchive = yield* mutateArchive(
				archiveInput({
					...records,
					entityDependencies: [
						dependency("one", [translation("one", "en")]),
						dependency("two", [translation("two", "fr")]),
					],
				}),
				(files) => {
					const path = "entity-dependencies.ndjson";
					const section = files[path];
					assert(section !== undefined);
					const dependencies = new TextDecoder()
						.decode(section)
						.trimEnd()
						.split("\n")
						.map((line) => Schema.decodeUnknownSync(V1EntityDependency)(JSON.parse(line)));
					const secondDependency = dependencies[1];
					const first = dependencies[0]?.translations[0];
					const second = secondDependency?.translations[0];
					assert(first !== undefined && second !== undefined && secondDependency !== undefined);
					dependencies[1] = {
						...secondDependency,
						translations: [{ ...second, id: first.id }],
					};
					replaceSection(
						files,
						path,
						encoder.encode(`${dependencies.map((value) => JSON.stringify(value)).join("\n")}\n`),
					);
				},
			);
			expect((yield* validationError(Stream.make(duplicateIdArchive))).reason).toBe(
				"duplicate_record_id",
			);

			const duplicateLanguageArchive = yield* mutateArchive(
				archiveInput({
					...records,
					entityDependencies: [
						dependency("one", [translation("one", "en"), translation("two", "fr")]),
					],
				}),
				(files) => {
					const path = "entity-dependencies.ndjson";
					const section = files[path];
					assert(section !== undefined);
					const record = Schema.decodeUnknownSync(V1EntityDependency)(
						JSON.parse(new TextDecoder().decode(section).trimEnd()),
					);
					const first = record.translations[0];
					const second = record.translations[1];
					assert(first !== undefined && second !== undefined);
					replaceSection(
						files,
						path,
						encoder.encode(
							`${JSON.stringify({
								...record,
								translations: [first, { ...second, language: first.language }],
							})}\n`,
						),
					);
				},
			);
			expect((yield* validationError(Stream.make(duplicateLanguageArchive))).reason).toBe(
				"duplicate_record_id",
			);
		}),
	);

	it.effect("rejects an asset stream that differs from its manifest metadata", () =>
		Effect.gen(function* () {
			const input = archiveInput();
			const asset = input.assets[0];
			assert(asset !== undefined);
			const error = yield* Stream.runDrain(
				createV1ArchiveStream({
					...input,
					assets: [{ ...asset, chunks: [encoder.encode("changed asset bytes")] }],
				}),
			).pipe(Effect.flip);
			expect(error).toBeInstanceOf(BackupArchiveError);
			expect(error).toMatchObject({ reason: "checksum_mismatch" });
		}),
	);

	it.effect("honors lower test entry limits", () =>
		Effect.gen(function* () {
			const error = yield* validateV1ArchiveStream(createV1ArchiveStream(archiveInput()), {
				limits: { maxEntryCount: 1 },
			}).pipe(Effect.provide(BunFileSystem.layer), Effect.flip);
			expect(error.reason).toBe("entry_count_exceeded");
		}),
	);
});
