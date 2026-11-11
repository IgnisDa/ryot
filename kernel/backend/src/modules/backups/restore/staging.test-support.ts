import type { AssetLocator } from "@ryot-app/contract/modules/assets/schemas";
import { identityTupleKey } from "@ryot-app/contract/modules/plugins/references";
import { BackupRunId, type UserId } from "@ryot-app/contract/schema/brands";
import { randomUuid } from "@ryot-app/testing/random";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer, Schema, Stream } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/backups";

import { archiveFixtureMetadata } from "../archive/archive.test-support";
import { archiveError } from "../archive/error";
import type { ArchiveEvent, ArchiveRecords } from "../archive/schemas";
import { ArchiveUserEntity } from "../archive/schemas";
import type { ArchiveSectionReader, ArchiveSections } from "../archive/sections";
import { BACKUP_STAGE_BATCH_SIZE, BackupStaging } from "../staging";
import { BackupRestoreWriter } from "./writer";

type StagingReference = Parameters<BackupStaging["Service"]["addReferences"]>[1][number];
type StagedRecord = Effect.Success<ReturnType<BackupStaging["Service"]["listRecords"]>>[number];

export const FixtureStagingUsesDatabase = Context.Reference<boolean>(
	"test/BackupRestoreFixtureStagingUsesDatabase",
	{ defaultValue: () => true },
);

const fixtureReader = <A>(values: ReadonlyArray<A>): ArchiveSectionReader<A> => ({
	sha256: "",
	count: values.length,
	read: () => Stream.fromIterable(values),
});

export const fixtureArchiveReaders = (
	records: ArchiveRecords,
	eventReader: ArchiveSectionReader<ArchiveEvent>,
): ArchiveSections => ({
	"events.ndjson": eventReader,
	"pages.ndjson": fixtureReader([]),
	"entities.ndjson": fixtureReader(records.entities),
	"reminders.ndjson": fixtureReader(records.reminders),
	"fold-values.ndjson": fixtureReader(records.foldValues),
	"saved-views.ndjson": fixtureReader(records.savedViews),
	"integrations.ndjson": fixtureReader(records.integrations),
	"publications.ndjson": fixtureReader(records.publications),
	"relationships.ndjson": fixtureReader(records.relationships),
	"entity-dependencies.ndjson": fixtureReader(records.entityDependencies),
	"calendar-source-overrides.ndjson": fixtureReader(records.calendarSourceOverrides),
	"notification-subscriptions.ndjson": fixtureReader(records.notificationSubscriptions),
});

type MemoryRun = {
	readonly records: Map<string, StagedRecord>;
	readonly references: Map<string, StagingReference>;
};

const createMemoryRun = (): MemoryRun => ({ records: new Map(), references: new Map() });
const recordKey = (namespace: string, id: string) => JSON.stringify([namespace, id]);
const StagedEntityIdentity = Schema.Struct({
	entitySchemaSlug: ArchiveUserEntity.fields.entitySchemaSlug,
	entitySchemaPluginKey: ArchiveUserEntity.fields.entitySchemaPluginKey,
});

const makeMemoryStaging = (): BackupStaging["Service"] => {
	const runs = new Map<string, MemoryRun>();
	const runFor = (runId: string) => {
		let run = runs.get(runId);
		if (!run) {
			run = createMemoryRun();
			runs.set(runId, run);
		}
		return run;
	};

	return {
		recoverAbandoned: () => Effect.void,
		cleanup: (runId) => Effect.sync(() => void runs.delete(runId)),
		begin: (runId) =>
			Effect.sync(() => {
				runs.set(runId, createMemoryRun());
			}),
		getRecords: (runId, namespace, ids) =>
			Effect.sync(() => {
				const records = runs.get(runId)?.records;
				return ids.flatMap((id) => {
					const record = records?.get(recordKey(namespace, id));
					return record ? [record] : [];
				});
			}),
		addReferences: (runId, references) =>
			Effect.sync(() => {
				const run = runFor(runId);
				for (const reference of references) {
					run.references.set(
						identityTupleKey(
							reference.sourceNamespace,
							reference.sourceId,
							reference.targetNamespace,
							reference.targetId,
						),
						reference,
					);
				}
			}),
		resolveMappings: (runId, namespace, ids) =>
			Effect.sync(() => {
				const mappings = new Map<string, string>();
				const records = runs.get(runId)?.records;
				for (const id of ids) {
					const destinationId = records?.get(recordKey(namespace, id))?.destinationId;
					if (destinationId !== null && destinationId !== undefined) {
						mappings.set(id, destinationId);
					}
				}
				return mappings;
			}),
		setMappings: (runId, namespace, mappings) =>
			Effect.sync(() => {
				const records = runFor(runId).records;
				for (const mapping of mappings) {
					const key = recordKey(namespace, mapping.id);
					const record = records.get(key);
					if (record) {
						records.set(key, {
							...record,
							destinationId: mapping.destinationId,
							inserted: mapping.inserted ?? record.inserted,
						});
					}
				}
			}),
		validateReferences: (runId) =>
			Effect.gen(function* () {
				const run = runFor(runId);
				for (const reference of run.references.values()) {
					if (!run.records.has(recordKey(reference.targetNamespace, reference.targetId))) {
						return yield* archiveError(
							"missing_reference_mapping",
							"Backup contains a reference without a staged target mapping",
						);
					}
				}
				return yield* Effect.void;
			}),
		listRecords: (runId, section, afterId, limit = BACKUP_STAGE_BATCH_SIZE) =>
			Effect.sync(() => {
				const boundedLimit = Number.isFinite(limit)
					? Math.max(0, Math.min(BACKUP_STAGE_BATCH_SIZE, Math.trunc(limit)))
					: BACKUP_STAGE_BATCH_SIZE;
				return [...(runs.get(runId)?.records.values() ?? [])]
					.filter(
						(record) =>
							record.section === section && (afterId === undefined || record.id > afterId),
					)
					.sort((left, right) => {
						if (left.id < right.id) {
							return -1;
						}
						return left.id > right.id ? 1 : 0;
					})
					.slice(0, boundedLimit);
			}),
		getEntityIdentities: (runId, ids) =>
			Effect.gen(function* () {
				const rows = yield* Effect.forEach(ids, (id) =>
					Effect.sync(() => runs.get(runId)?.records.get(recordKey("entity", id))).pipe(
						Effect.flatMap((record) =>
							record
								? Schema.decodeUnknownEffect(StagedEntityIdentity)(record.value).pipe(
										Effect.orDie,
										Effect.map((entity) => ({
											id: record.id,
											section: record.section,
											inserted: record.inserted,
											destinationId: record.destinationId,
											entitySchemaSlug: entity.entitySchemaSlug,
											entitySchemaPluginKey: entity.entitySchemaPluginKey,
										})),
									)
								: Effect.succeed(null),
						),
					),
				);
				return rows.flatMap((row) => (row === null ? [] : [row]));
			}),
		putRecords: (runId, namespace, section, records) =>
			Effect.gen(function* () {
				const run = runFor(runId);
				const pending: Array<StagedRecord> = [];
				for (const { id, value } of records) {
					const key = recordKey(namespace, id);
					if (
						run.records.has(key) ||
						pending.some((record) => recordKey(record.namespace, record.id) === key)
					) {
						return yield* archiveError(
							"duplicate_record_id",
							`Duplicate record id in backup section '${section}'`,
							section,
						);
					}
					pending.push({
						id,
						runId,
						value,
						section,
						namespace,
						inserted: false,
						destinationId: null,
					});
				}
				for (const record of pending) {
					run.records.set(recordKey(namespace, record.id), record);
				}
				return yield* Effect.void;
			}),
	};
};

export const memoryStagingLayer = Layer.mergeAll(
	Layer.effect(BackupStaging, Effect.sync(makeMemoryStaging)),
	Layer.succeed(FixtureStagingUsesDatabase, false),
);

export const restoreFixtureRecords = (
	userId: UserId,
	records: ArchiveRecords,
	assetLocators: ReadonlyMap<string, AssetLocator>,
	eventReader: ArchiveSectionReader<ArchiveEvent>,
	pluginIds: ReadonlyMap<string, string>,
	definitions: Parameters<BackupRestoreWriter["Service"]["stageArchive"]>[4],
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const writer = yield* BackupRestoreWriter;
			const staging = yield* BackupStaging;
			const session = yield* DatabaseSession;
			const runId = BackupRunId.make(yield* randomUuid);
			const useDatabase = yield* FixtureStagingUsesDatabase;
			const metadata = archiveFixtureMetadata(records);
			const deleteRun = useDatabase
				? session
						.run((db) => db.delete(tables.backupRun).where(eq(tables.backupRun.id, runId)))
						.pipe(Effect.asVoid, Effect.orDie)
				: Effect.void;
			yield* Effect.addFinalizer(() =>
				Effect.ensuring(staging.cleanup(runId).pipe(Effect.orDie), deleteRun),
			);
			if (useDatabase) {
				yield* session.run((db) =>
					db
						.insert(tables.backupRun)
						.values({ userId, id: runId, kind: "restore", status: "running" }),
				);
			}
			yield* staging.begin(runId);
			yield* writer.stageArchive(
				runId,
				metadata,
				fixtureArchiveReaders(records, eventReader),
				pluginIds,
				definitions,
			);
			yield* session.transaction(
				writer.restoreArchive(userId, runId, metadata, pluginIds, definitions, assetLocators),
			);
		}),
	);
