import { expect } from "bun:test";
import { fileURLToPath } from "node:url";

import { BunFileSystem } from "@effect/platform-bun";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { it, layer } from "@voila.dev/effect-bun-test";
import { sql } from "drizzle-orm";
import { Effect, FileSystem, Layer, Stream } from "effect";

import { AuthRepository } from "#modules/accounts/auth/repository";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { AutomationsRepository } from "#modules/automations/repository";
import { BackupsRepository } from "#modules/backups/runs/repository";
import { BackupStaging } from "#modules/backups/staging";
import { DefinitionRepository } from "#modules/definitions/repository";
import { TranslationsRepository } from "#modules/entities/localization/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { pluginContentHash } from "#modules/plugins/packages/pipeline";
import { PluginRepository } from "#modules/plugins/packages/repository";
import {
	makeRevisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { testDatabaseUrl } from "#testing/database";
import { makeAppConfigLayer } from "#testing/effect";
import { testRedisUrl } from "#testing/redis";

import { createArchiveStream, validateArchiveStream } from "./archive/archive";
import { BackupExportSnapshot } from "./export/snapshot";
import { BackupRestoreWriter } from "./restore/writer";

const sourceUserId = UserId.make("owner");
const targetUserId = UserId.make("recipient");
const memoryRecordCount = 5_000;
const memoryRelationshipCount = 5_000;
const memoryEventCount = 10_000;
const memoryReminderCount = 5_000;
const memoryLimitBytes = 512 * 1024 * 1024;

const entityPropertiesSchema = {
	fields: {
		payload: { type: "string", label: "Payload", description: "Large record payload" },
		peerIds: {
			type: "array",
			label: "Peers",
			description: "Cyclic peer references",
			items: {
				label: "Peer",
				type: "string",
				description: "Referenced record",
				reference: { required: true, kind: "entity-id" },
			},
		},
	},
} as const;

const eventPropertiesSchema = {
	fields: {
		peerIds: entityPropertiesSchema.fields.peerIds,
		notes: { type: "string", label: "Notes", description: "Event notes" },
		frozen: { type: "number", label: "Frozen", description: "Frozen numeric value" },
	},
} as const;

const relationshipPropertiesSchema = {
	fields: {
		note: { label: "Note", type: "string", description: "Relationship note" },
		nextRelationshipId: {
			type: "string",
			label: "Next relationship",
			description: "Cyclic relationship reference",
			reference: { required: true, kind: "relationship-id" },
		},
	},
} as const;

const packageWithMemoryDefinitions = () => {
	const base = revisionPackage("streaming-memory", "v1", "record");
	const manifest: PluginManifest = {
		...base.manifest,
		crons: [],
		hooks: [],
		scripts: [],
		providers: [],
		workflows: [],
		operations: [],
		userBootstrap: [],
		signalSchemas: [],
		relationshipSchemas: [
			{
				name: "Linked",
				slug: "linked",
				sourceEntitySchemaSlug: "record",
				targetEntitySchemaSlug: "record",
				propertiesSchema: relationshipPropertiesSchema,
			},
		],
		entitySchemas: [
			{
				icon: "box",
				name: "Record",
				slug: "record",
				propertiesSchema: entityPropertiesSchema,
				eventSchemas: [
					{ name: "Observed", slug: "observed", propertiesSchema: eventPropertiesSchema },
				],
			},
		],
	};
	return { ...base, manifest, scripts: [], contentHash: pluginContentHash(manifest) };
};

const dependencies = Layer.mergeAll(
	AuthRepository.layer,
	AutomationsRepository.layer,
	EntitiesRepository.layer,
	EventsRepository.layer,
	IntegrationsRepository.layer,
	PluginInstallationRepository.layer,
	RelationshipsRepository.layer,
	SavedViewsRepository.layer,
	TranslationsRepository.layer,
).pipe(Layer.provide(makeAppConfigLayer()));

const services = Layer.mergeAll(
	BackupExportSnapshot.layer,
	BackupRestoreWriter.layer.pipe(Layer.provideMerge(BackupStaging.layer)),
	BackupsRepository.layer,
).pipe(
	Layer.provideMerge(dependencies),
	Layer.provideMerge(makeRevisionDatabaseLayer()),
	Layer.provideMerge(BunFileSystem.layer),
	Layer.provide(
		Layer.mock(ManagedAssetsService, { verifyManagedAssetOwnership: () => Effect.succeed([]) }),
	),
);

const seedMemoryRecords = (session: DatabaseSession["Service"], pluginId: string) =>
	session.run((db) =>
		db.execute(sql`
			insert into ${tables.entity} (
				id, user_id, name, entity_schema_slug, entity_schema_plugin_id, properties
			)
			select
				'memory-entity-' || lpad(source.n::text, 5, '0'),
				${sourceUserId},
				'Memory record ' || source.n,
				'record',
				${pluginId},
				jsonb_build_object(
					'payload', repeat('x', 16384),
					'peerIds', jsonb_build_array(
						'memory-entity-' || lpad((source.n % ${memoryRecordCount} + 1)::text, 5, '0')
					)
				)
			from generate_series(1, ${memoryRecordCount}) as source(n)
		`),
	);

const seedMemoryRelationships = (session: DatabaseSession["Service"], pluginId: string) =>
	session.run((db) =>
		db.execute(sql`
			insert into ${tables.relationship} (
				id, user_id, relationship_schema_slug, relationship_schema_plugin_id,
				source_entity_id, target_entity_id, properties
			)
			select
				'memory-relationship-' || lpad(source.n::text, 5, '0'),
				${sourceUserId},
				'linked',
				${pluginId},
				'memory-entity-' || lpad(source.n::text, 5, '0'),
				'memory-entity-' || lpad((source.n % ${memoryRecordCount} + 1)::text, 5, '0'),
				jsonb_build_object(
					'nextRelationshipId',
						'memory-relationship-' || lpad((source.n % ${memoryRelationshipCount} + 1)::text, 5, '0'),
					'note', repeat('r', 2048)
				)
			from generate_series(1, ${memoryRelationshipCount}) as source(n)
		`),
	);

const seedMemoryEvents = (session: DatabaseSession["Service"], pluginId: string) =>
	session.run((db) =>
		db.execute(sql`
			insert into ${tables.event} (
				id, user_id, entity_id, event_schema_slug, event_schema_plugin_id,
				occurred_at, properties
			)
			select
				'memory-event-' || lpad(source.n::text, 5, '0'),
				${sourceUserId},
				'memory-entity-' || lpad((((source.n - 1) / 2) + 1)::text, 5, '0'),
				'observed',
				${pluginId},
				'2026-10-01T00:00:00.000Z'::timestamptz,
				jsonb_build_object(
					'frozen', 12.5,
					'notes', repeat('e', 4096),
					'peerIds', jsonb_build_array(
						'memory-entity-' || lpad(((((source.n - 1) / 2) + 1) % ${memoryRecordCount} + 1)::text, 5, '0')
					)
				)
			from generate_series(1, ${memoryEventCount}) as source(n)
		`),
	);

const seedMemoryReminders = (session: DatabaseSession["Service"]) =>
	session.run((db) =>
		db.execute(sql`
			insert into ${tables.reminder} (
				id, user_id, state, reason, message, entity_title, entity_id,
				parent_entity_id, replacement_id, account_generation
			)
			select
				'memory-reminder-' || lpad(source.n::text, 5, '0'),
				${sourceUserId},
				'cancelled',
				'cancelled',
				repeat('m', 2048),
				'Memory record ' || source.n,
				'memory-entity-' || lpad(source.n::text, 5, '0'),
				'memory-entity-' || lpad((source.n % ${memoryRecordCount} + 1)::text, 5, '0'),
				'memory-reminder-' || lpad((source.n % ${memoryReminderCount} + 1)::text, 5, '0'),
				'test-account-generation'
			from generate_series(1, ${memoryReminderCount}) as source(n)
		`),
	);

if (process.env["RYOT_BACKUP_MEMORY_CHILD"] !== "1") {
	it.live(
		"exports and restores large backup data below the fixed memory limit",
		() =>
			Effect.gen(function* () {
				const child = yield* Effect.acquireRelease(
					Effect.sync(() =>
						Bun.spawn(
							[
								process.execPath,
								"test",
								"--isolate",
								"--timeout=120000",
								"src/modules/backups/streaming-memory.test.ts",
							],
							{
								stdout: "pipe",
								stderr: "pipe",
								cwd: fileURLToPath(new URL("../../../", import.meta.url)),
								env: {
									...process.env,
									RYOT_BACKUP_MEMORY_CHILD: "1",
									TEST_REDIS_URL: testRedisUrl(),
									TEST_DATABASE_URL: testDatabaseUrl(),
								},
							},
						),
					),
					(childProcess) =>
						Effect.sync(() => {
							if (childProcess.exitCode === null) {
								childProcess.kill();
							}
						}),
				);
				const [exitCode, stdout, stderr] = yield* Effect.all(
					[
						Effect.promise(() => child.exited),
						Effect.promise(() => new Response(child.stdout).text()),
						Effect.promise(() => new Response(child.stderr).text()),
					],
					{ concurrency: 3 },
				);
				expect(exitCode, `Child stdout:\n${stdout}\nChild stderr:\n${stderr}`).toBe(0);
			}),
		600_000,
	);
} else {
	layer(services)((test) => {
		test.effect(
			"streams export and restore sections without retaining record-sized data",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const installations = yield* PluginInstallationRepository;
					const plugins = yield* PluginRepository;
					const pluginId = yield* session.transaction(
						Effect.gen(function* () {
							yield* plugins.lockIngestion();
							const id = yield* plugins.persist(packageWithMemoryDefinitions(), {
								ownerId: null,
								scope: "system",
							});
							yield* plugins.resolveEnvironmentConfigs();
							return id;
						}),
					);
					yield* installations.provisionSystemInstallationsForUser(sourceUserId);
					yield* installations.provisionSystemInstallationsForUser(targetUserId);
					yield* seedMemoryRecords(session, pluginId);
					yield* seedMemoryRelationships(session, pluginId);
					yield* seedMemoryEvents(session, pluginId);
					yield* seedMemoryReminders(session);

					const runs = yield* BackupsRepository;
					const staging = yield* BackupStaging;
					const exportRun = yield* runs.createRun({ kind: "export", userId: sourceUserId });
					const restoreRun = yield* runs.createRun({ kind: "restore", userId: targetUserId });
					expect(
						yield* runs.markRunRunning({ runId: exportRun.id, userId: sourceUserId }),
					).not.toBeNull();
					expect(
						yield* runs.markRunRunning({ userId: targetUserId, runId: restoreRun.id }),
					).not.toBeNull();
					yield* staging.begin(exportRun.id);
					yield* Effect.addFinalizer(() => staging.cleanup(exportRun.id).pipe(Effect.orDie));
					yield* staging.begin(restoreRun.id);
					yield* Effect.addFinalizer(() => staging.cleanup(restoreRun.id).pipe(Effect.orDie));

					const fs = yield* FileSystem.FileSystem;
					const directory = yield* fs.makeTempDirectoryScoped();
					const eventsPath = `${directory}/snapshot`;
					const snapshot = yield* session.transaction(
						Effect.gen(function* () {
							yield* session.run((db) =>
								db.execute(sql`set transaction isolation level repeatable read`),
							);
							return yield* (yield* BackupExportSnapshot).prepareExportSnapshot(
								sourceUserId,
								eventsPath,
								exportRun.id,
							);
						}),
					);
					const archivePath = `${directory}/backup.zip`;
					yield* Stream.run(
						createArchiveStream({
							assets: [],
							records: snapshot.records,
							redactions: snapshot.redactions,
							appVersion: "streaming-memory-test",
							createdAt: "2026-10-01T00:00:00.000Z",
							archiveId: "streaming-memory-regression",
							requiredPlugins: snapshot.requiredPlugins,
							sections: snapshot.sections.map((section) => ({
								path: section.path,
								count: section.count,
								bytes: section.bytes,
								sha256: section.sha256,
								chunks: Stream.toAsyncIterable(fs.stream(section.filePath)),
							})),
						}),
						fs.sink(archivePath),
					);
					expect(
						yield* session.transaction(
							runs.completeRun({ runId: exportRun.id, userId: sourceUserId }),
						),
					).not.toBeNull();

					const validated = yield* validateArchiveStream(fs.stream(archivePath), { directory });
					const writer = yield* BackupRestoreWriter;
					const pluginIds = yield* writer.assertRequiredPlugins(validated.manifest.requiredPlugins);
					const definitions = yield* (yield* DefinitionRepository).getUserSnapshot(targetUserId, {
						listed: true,
					});
					yield* writer.stageArchive(
						restoreRun.id,
						validated.records,
						validated.sections,
						pluginIds,
						definitions,
					);
					yield* writer.preflightArchive(
						restoreRun.id,
						validated.records,
						pluginIds,
						definitions,
						validated.manifest.requiredPlugins,
					);
					yield* session.transaction(
						Effect.gen(function* () {
							yield* session.acquireUserWriteLock(targetUserId);
							yield* writer.restoreArchive(
								targetUserId,
								restoreRun.id,
								validated.records,
								pluginIds,
								definitions,
								new Map(),
							);
							expect(
								yield* runs.completeRun({ userId: targetUserId, runId: restoreRun.id }),
							).toMatchObject({ status: "completed" });
						}),
					);

					const [counts] = yield* session.run((db) =>
						db.execute<{
							events: number;
							entities: number;
							reminders: number;
							relationships: number;
							reusedEntityIds: number;
							missingReminderReferences: number;
							missingRelationshipReferences: number;
						}>(
							sql`
							select
								(select count(*)::integer from ${tables.entity} where user_id = ${targetUserId}) as entities,
								(select count(*)::integer from ${tables.relationship} where user_id = ${targetUserId}) as relationships,
								(select count(*)::integer from ${tables.event} where user_id = ${targetUserId}) as events,
								(select count(*)::integer from ${tables.reminder} where user_id = ${targetUserId}) as reminders,
								(
									select count(*)::integer
									from ${tables.entity} as source
									inner join ${tables.entity} as restored on restored.id = source.id
									where source.user_id = ${sourceUserId} and restored.user_id = ${targetUserId}
								) as "reusedEntityIds",
								(
									select count(*)::integer
									from ${tables.relationship} as relationship
									left join ${tables.relationship} as next_relationship
										on next_relationship.id = relationship.properties->>'nextRelationshipId'
										and next_relationship.user_id = relationship.user_id
									left join ${tables.entity} as source_entity
										on source_entity.id = relationship.source_entity_id
										and source_entity.user_id = relationship.user_id
									left join ${tables.entity} as target_entity
										on target_entity.id = relationship.target_entity_id
										and target_entity.user_id = relationship.user_id
									where relationship.user_id = ${targetUserId}
										and (next_relationship.id is null or source_entity.id is null or target_entity.id is null)
								) as "missingRelationshipReferences",
								(
									select count(*)::integer
									from ${tables.reminder} as reminder
									left join ${tables.reminder} as replacement
										on replacement.id = reminder.replacement_id
										and replacement.user_id = reminder.user_id
									left join ${tables.entity} as entity
										on entity.id = reminder.entity_id and entity.user_id = reminder.user_id
									left join ${tables.entity} as parent
										on parent.id = reminder.parent_entity_id and parent.user_id = reminder.user_id
									where reminder.user_id = ${targetUserId}
										and (replacement.id is null or entity.id is null or parent.id is null)
								) as "missingReminderReferences"
						`,
							"objects",
						),
					);
					expect(counts).toEqual({
						reusedEntityIds: 0,
						events: memoryEventCount,
						entities: memoryRecordCount,
						missingReminderReferences: 0,
						reminders: memoryReminderCount,
						missingRelationshipReferences: 0,
						relationships: memoryRelationshipCount,
					});

					const [firstEvent] = yield* session.run((db) =>
						db.execute<{ frozen: number; peerId: string; peerIsDestination: boolean }>(
							sql`
							select
								(event.properties->>'frozen')::double precision as frozen,
								event.properties->'peerIds'->>0 as "peerId",
								exists (
									select 1 from ${tables.entity} as peer
									where peer.id = event.properties->'peerIds'->>0
										and peer.user_id = ${targetUserId}
								) as "peerIsDestination"
							from ${tables.event} as event
							where event.user_id = ${targetUserId} and event.event_schema_slug = 'observed'
							order by event.id
							limit 1
						`,
							"objects",
						),
					);
					expect(firstEvent?.frozen).toBe(12.5);
					expect(firstEvent?.peerIsDestination).toBe(true);
					expect(firstEvent?.peerId).not.toBe("memory-entity-00002");

					yield* staging.cleanup(exportRun.id);
					yield* staging.cleanup(restoreRun.id);
					const [staged] = yield* session.run((db) =>
						db.execute<{ runs: number; records: number; referenceRows: number }>(
							sql`
							select
								(select count(*)::integer from ${tables.backupStagingRun} where id in (${exportRun.id}, ${restoreRun.id})) as runs,
								(select count(*)::integer from ${tables.backupStagingRecord} where run_id in (${exportRun.id}, ${restoreRun.id})) as records,
								(select count(*)::integer from ${tables.backupStagingReference} where run_id in (${exportRun.id}, ${restoreRun.id})) as "referenceRows"
						`,
							"objects",
						),
					);
					expect(staged).toEqual({ runs: 0, records: 0, referenceRows: 0 });

					const maxRssBytes = process.resourceUsage().maxRSS * 1024;
					yield* Effect.logInfo({ counts, maxRssBytes, memoryLimitBytes });
					expect(maxRssBytes).toBeLessThan(memoryLimitBytes);
				}),
			600_000,
		);
	});
}
