import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot/contract/errors";
import { UserId } from "@ryot/contract/schema/brands";
import { Effect, Layer, Stream } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import type { MockOverrides } from "#lib/test-utils/effect";
import { AuthRepository } from "#modules/auth/repository";
import { AutomationsRepository } from "#modules/automations/repository";
import { DefinitionRegistry } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { EventsRepository, RESTORE_EVENT_BATCH_SIZE } from "#modules/events/repository";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import { V1_BOOTSTRAP_SOURCE, type V1Event } from "../archive-v1/schemas";
import {
	assertV1DependencySchemaOwnership,
	BackupRestoreWriter,
	resolveV1BootstrapSourceMapping,
	selectV1TranslationsForRestore,
} from "./writer";

const bootstrapSource = (id: string) => ({
	id,
	provider: null,
	properties: {},
	name: "Library",
	externalId: null,
	entitySchemaSlug: "library",
});

it.effect("maps the exact V1 bootstrap source without collapsing arbitrary rows", () =>
	Effect.gen(function* () {
		expect(
			yield* resolveV1BootstrapSourceMapping(
				[
					bootstrapSource("archived-library"),
					{
						provider: null,
						properties: {},
						externalId: null,
						name: "Arbitrary",
						id: "arbitrary-empty-row",
						entitySchemaSlug: "library",
					},
				],
				[bootstrapSource("target-library")],
			),
		).toEqual({ archivedId: "archived-library", targetId: "target-library" });
	}),
);

it.effect("rejects ambiguous archived V1 bootstrap sources", () =>
	resolveV1BootstrapSourceMapping(
		[bootstrapSource("first"), bootstrapSource("second")],
		[bootstrapSource("target")],
	).pipe(
		Effect.flip,
		Effect.tap((error) => Effect.sync(() => expect(error.message).toContain("exactly one"))),
	),
);

it.effect("rejects a crafted provider dependency whose schema belongs to another plugin", () =>
	assertV1DependencySchemaOwnership(
		{
			properties: {},
			id: "global-id",
			name: "Crafted",
			translations: [],
			populatedAt: null,
			externalId: "external-id",
			entitySchemaSlug: "foreign-schema",
			createdAt: "2026-08-23T12:00:00.000Z",
			updatedAt: "2026-08-23T12:00:00.000Z",
			provider: { pluginSlug: "provider-owner", providerSlug: "provider" },
			identity: { kind: "provider", pluginSlug: "provider-owner", providerSlug: "provider" },
		},
		"foreign-owner",
	).pipe(
		Effect.flip,
		Effect.tap((error) => Effect.sync(() => expect(error.message).toContain("not owned"))),
	),
);

it("does not apply archived translations to an existing global entity", () => {
	const translations = [
		{
			language: "en",
			properties: null,
			populatedAt: null,
			id: "translation-id",
			name: "Archived overwrite",
			createdAt: "2026-08-23T12:00:00.000Z",
			updatedAt: "2026-08-23T12:00:00.000Z",
		},
	];
	expect(selectV1TranslationsForRestore(false, translations)).toEqual([]);
	expect(selectV1TranslationsForRestore(true, translations)).toBe(translations);
});

const mockEvents = Layer.mock(EventsRepository);
type RestoreEventsMock = NonNullable<MockOverrides<typeof mockEvents>["restoreEvents"]>;

const eventSchema = { name: "Review", slug: "review", propertiesSchema: { fields: {} } };
const bootstrapEntitySchema = {
	icon: "book",
	pluginSlug: "media",
	mergeIdentityProperties: [],
	name: V1_BOOTSTRAP_SOURCE.name,
	propertiesSchema: { fields: {} },
	eventSchemas: { review: eventSchema },
	slug: V1_BOOTSTRAP_SOURCE.entitySchemaSlug,
};

const archivedEvent = (id: string): V1Event => ({
	id,
	properties: {},
	sessionEntityId: null,
	eventSchemaSlug: "review",
	entityId: "archived-library",
	createdAt: "2026-08-23T12:00:00.000Z",
	updatedAt: "2026-08-23T12:00:00.000Z",
	occurredAt: "2026-08-23T12:00:00.000Z",
});

const restoreArchivedEvents = (events: ReadonlyArray<V1Event>, restoreEvents: RestoreEventsMock) =>
	Effect.gen(function* () {
		const writer = yield* BackupRestoreWriter;
		return yield* writer.restoreRecords(
			UserId.make("user-id"),
			{
				savedViews: [],
				pluginState: [],
				relationships: [],
				entityDependencies: [],
				notificationSubscriptions: [],
				profile: { name: "User", image: null, preferences: {} },
				entities: [
					{
						properties: {},
						provider: null,
						externalId: null,
						populatedAt: null,
						id: "archived-library",
						name: V1_BOOTSTRAP_SOURCE.name,
						createdAt: "2026-08-23T12:00:00.000Z",
						updatedAt: "2026-08-23T12:00:00.000Z",
						entitySchemaSlug: V1_BOOTSTRAP_SOURCE.entitySchemaSlug,
					},
				],
			},
			new Map(),
			{ count: events.length, sha256: "", read: () => Stream.fromIterable(events) },
		);
	}).pipe(
		Effect.provide(
			BackupRestoreWriter.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						Layer.mock(PluginRepository, {
							listPortablePluginMetadata: () => Effect.succeed([]),
						}),
						Layer.mock(AuthRepository, { restorePortableProfile: () => Effect.succeed(true) }),
						Layer.mock(EventsRepository, { restoreEvents }),
						Layer.mock(EntitiesRepository, {
							listUserEntitiesForBackup: () =>
								Effect.succeed([
									{
										properties: {},
										provider: null,
										externalId: null,
										populatedAt: null,
										id: "target-library",
										name: V1_BOOTSTRAP_SOURCE.name,
										createdAt: new Date("2026-08-23T12:00:00.000Z"),
										updatedAt: new Date("2026-08-23T12:00:00.000Z"),
										entitySchemaSlug: V1_BOOTSTRAP_SOURCE.entitySchemaSlug,
									},
								]),
						}),
						Layer.mock(DefinitionRegistry, {
							replace: () => undefined,
							getSavedView: () => undefined,
							getSignalSchema: () => undefined,
							getRelationshipSchema: () => undefined,
							getEntitySchema: () => bootstrapEntitySchema,
							getSnapshot: () => ({
								savedViews: {},
								signalSchemas: {},
								relationshipSchemas: {},
								entitySchemas: { [V1_BOOTSTRAP_SOURCE.entitySchemaSlug]: bootstrapEntitySchema },
							}),
							getEventSchema: () => eventSchema,
							validateEventProperties: () => Effect.succeed({}),
						}),
						Layer.mock(SavedViewsRepository, {}),
						Layer.mock(AutomationsRepository, {}),
						Layer.mock(PluginInstallationRepository, {}),
						Layer.mock(TranslationsRepository, {}),
						Layer.mock(RelationshipsRepository, {}),
						Layer.succeed(Database, Object.create(null)),
					),
				),
			),
		),
	);

it.effect("restores archived events in bounded batches", () => {
	const batches: number[] = [];
	const events = Array.from({ length: RESTORE_EVENT_BATCH_SIZE + 3 }, (_, index) =>
		archivedEvent(`event-${index.toString().padStart(5, "0")}`),
	);
	return Effect.gen(function* () {
		yield* restoreArchivedEvents(events, (batch) =>
			Effect.sync(() => void batches.push(batch.length)),
		);
		expect(batches).toEqual([RESTORE_EVENT_BATCH_SIZE, 3]);
	});
});

it.effect("reports a duplicate archived event id through the primary key insert", () =>
	Effect.gen(function* () {
		const error = yield* restoreArchivedEvents([archivedEvent("event-1")], () =>
			Effect.fail(new DbError({ code: "23505", message: "duplicate key value" })),
		).pipe(Effect.flip);
		expect(error).toMatchObject({
			path: "events.ndjson",
			_tag: "BackupArchiveError",
			reason: "duplicate_record_id",
		});
	}),
);
