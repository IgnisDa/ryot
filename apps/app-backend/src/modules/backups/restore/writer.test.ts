import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot/contract/errors";
import type { SavedViewLayouts } from "@ryot/contract/modules/saved-views/schemas";
import { UserId } from "@ryot/contract/schema/brands";
import type { AppSchema } from "@ryot/contract/schema/property-schema";
import { ascending, column, document, field, rows, table } from "@ryot/ryotql";
import { Effect, Layer, Stream } from "effect";

import { Database } from "#lib/infrastructure/db/service";
import type { MockOverrides } from "#lib/test-utils/effect";
import { AuthRepository } from "#modules/auth/repository";
import { AutomationsRepository } from "#modules/automations/repository";
import type { DefinitionSnapshot } from "#modules/definition-registry/service";
import { EntitiesRepository } from "#modules/entities/repository";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { EventsRepository, RESTORE_EVENT_BATCH_SIZE } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { PluginRepository } from "#modules/plugins/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import { V2_BOOTSTRAP_SOURCE, type V2ArchiveRecords, type V2Event } from "../archive-v2/schemas";
import {
	assertV2DependencySchemaOwnership,
	BackupRestoreWriter,
	preflightV2Provenance,
	resolveV2BootstrapSourceMapping,
	resolveV2RestoredIntegrationDisabled,
	resolveV2RestoredInstallationLifecycle,
	resolveV2RequiredPluginIds,
	selectV2TranslationsForRestore,
} from "./writer";

it("keeps restored installations inactive when required secrets were redacted", () => {
	expect(
		resolveV2RestoredInstallationLifecycle(
			{
				disabledIntent: false,
				lifecycleIntent: "ready",
				configuredSecretPaths: ["/token"],
			},
			{
				unknownKeys: "strict",
				fields: {
					token: {
						secret: true,
						type: "string",
						label: "Token",
						description: "Token",
						validation: { required: true },
					},
				},
			},
		),
	).toEqual({ health: "needs-configuration", isDisabled: true });
});

it("preserves needs-configuration health when the secret was already absent", () => {
	expect(
		resolveV2RestoredInstallationLifecycle(
			{
				disabledIntent: true,
				configuredSecretPaths: [],
				lifecycleIntent: "needs-configuration",
			},
			{ fields: {}, unknownKeys: "strict" },
		),
	).toEqual({ health: "needs-configuration", isDisabled: true });
});

it.effect("requires an exact system plugin version and source hash", () =>
	Effect.gen(function* () {
		const required = [{ slug: "system", version: "1.0.0", sourceHash: "a".repeat(64) }];
		const installed = [
			{ id: "plugin-id", slug: "system", version: "1.0.0", sourceHash: "b".repeat(64) },
		];
		const error = yield* resolveV2RequiredPluginIds(required, installed).pipe(Effect.flip);
		expect(error).toMatchObject({ pluginSlug: "system", requiredVersion: "1.0.0" });
	}),
);

it("detects nested required installation secrets in objects and arrays", () => {
	const schema = {
		unknownKeys: "strict" as const,
		fields: {
			credentials: {
				type: "object" as const,
				label: "Credentials",
				description: "Credentials",
				properties: {
					token: {
						secret: true as const,
						type: "string" as const,
						label: "Token",
						description: "Token",
						validation: { required: true },
					},
				},
			},
			accounts: {
				type: "array" as const,
				label: "Accounts",
				description: "Accounts",
				items: {
					type: "object" as const,
					label: "Account",
					description: "Account",
					properties: {
						token: {
							secret: true as const,
							type: "string" as const,
							label: "Token",
							description: "Token",
							validation: { required: true },
						},
					},
				},
			},
		},
	} satisfies AppSchema;
	for (const path of ["/credentials/token", "/accounts/0/token"]) {
		expect(
			resolveV2RestoredInstallationLifecycle(
				{ disabledIntent: false, lifecycleIntent: "ready", configuredSecretPaths: [path] },
				schema,
			),
		).toEqual({ health: "needs-configuration", isDisabled: true });
		expect(
			resolveV2RestoredIntegrationDisabled(
				{ isDisabled: false, configuredSecretPaths: [path] },
				schema,
			),
		).toBe(true);
	}
});

const bootstrapSource = (id: string) => ({
	id,
	provider: null,
	properties: {},
	name: "Library",
	externalId: null,
	entitySchemaSlug: "library",
});

it.effect("maps the exact V2 bootstrap source without collapsing arbitrary rows", () =>
	Effect.gen(function* () {
		expect(
			yield* resolveV2BootstrapSourceMapping(
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

it.effect("rejects ambiguous archived V2 bootstrap sources", () =>
	resolveV2BootstrapSourceMapping(
		[bootstrapSource("first"), bootstrapSource("second")],
		[bootstrapSource("target")],
	).pipe(
		Effect.flip,
		Effect.tap((error) => Effect.sync(() => expect(error.message).toContain("exactly one"))),
	),
);

it.effect("rejects a crafted provider dependency whose schema belongs to another plugin", () =>
	assertV2DependencySchemaOwnership(
		{
			properties: {},
			id: "global-id",
			name: "Crafted",
			translations: [],
			populatedAt: null,
			externalId: "external-id",
			entitySchemaSlug: "foreign-schema",
			entitySchemaPluginKey: "provider-owner",
			createdAt: "2026-08-23T12:00:00.000Z",
			updatedAt: "2026-08-23T12:00:00.000Z",
			provider: { pluginKey: "provider-owner", providerSlug: "provider" },
			identity: { kind: "provider", pluginKey: "provider-owner", providerSlug: "provider" },
		},
		"foreign-owner",
	).pipe(
		Effect.flip,
		Effect.tap((error) => Effect.sync(() => expect(error.message).toContain("not owned"))),
	),
);

const provenanceEntity = table("entity", "owner-entity");
const provenanceQuery = document({
	savedView: rows(provenanceEntity, {
		orderBy: [ascending(column(provenanceEntity, "name"))],
		fields: [
			field("id", column(provenanceEntity, "id")),
			field("name", column(provenanceEntity, "name")),
		],
	}),
});
const provenanceCard = {
	callout: null,
	overline: null,
	imageField: null,
	titleField: "name",
	entityIdField: "id",
	queryDocument: provenanceQuery,
	primaryMetadata: null,
	secondaryMetadata: null,
} as const;
const provenanceLayouts = {
	grid: provenanceCard,
	list: provenanceCard,
	table: {
		imageField: null,
		entityIdField: "id",
		queryDocument: provenanceQuery,
		columns: [{ label: "Name", field: "name", displayKind: "text" }],
	},
} satisfies SavedViewLayouts;

const provenanceRecords = (
	input: {
		readonly builtinView?: boolean;
		readonly viewKey?: string | null;
		readonly entityKey?: string | null;
		readonly dependencyKey?: string | null;
		readonly relationshipKey?: string | null;
		readonly subscriptionKey?: string | null;
	} = {},
): V2ArchiveRecords => ({
	savedViews: [
		{
			layouts: provenanceLayouts,
			icon: "list",
			...(input.builtinView
				? { kind: "builtin-override" as const, isBuiltin: true as const }
				: { kind: "custom" as const, isBuiltin: false as const }),
			pluginKey: input.viewKey === undefined ? "owner-key" : input.viewKey,
			isDisabled: false,
			id: "saved-view-id",
			slug: "owner-view",
			name: "Owner view",
			entitySchemaSlug: "owner-entity",
			entitySchemaPluginKey: input.viewKey === undefined ? "owner-key" : input.viewKey,
			sortOrder: 0,
			createdAt: "2026-08-23T12:00:00.000Z",
			updatedAt: "2026-08-23T12:00:00.000Z",
		},
	],
	integrations: [],
	installations: [],
	privatePlugins: [],
	notificationSubscriptions: [
		{
			metadata: null,
			isActive: false,
			signalSchemaSlug: "owner.signal",
			signalSchemaPluginKey:
				input.subscriptionKey === undefined ? "owner-key" : input.subscriptionKey,
		},
	],
	profile: { name: "User", image: null, preferences: {} },
	entities: [
		{
			properties: {},
			provider: null,
			externalId: null,
			populatedAt: null,
			id: "user-entity",
			name: "User entity",
			entitySchemaSlug: "owner-entity",
			entitySchemaPluginKey: input.entityKey === undefined ? "owner-key" : input.entityKey,
			createdAt: "2026-08-23T12:00:00.000Z",
			updatedAt: "2026-08-23T12:00:00.000Z",
		},
	],
	entityDependencies: [
		{
			properties: {},
			provider: null,
			translations: [],
			externalId: null,
			populatedAt: null,
			id: "global-entity",
			name: "Global entity",
			identity: { kind: "unmanaged" },
			entitySchemaSlug: "owner-entity",
			entitySchemaPluginKey: input.dependencyKey === undefined ? "owner-key" : input.dependencyKey,
			createdAt: "2026-08-23T12:00:00.000Z",
			updatedAt: "2026-08-23T12:00:00.000Z",
		},
	],
	relationships: [
		{
			scope: "user",
			properties: {},
			id: "relationship-id",
			sourceEntityId: "user-entity",
			targetEntityId: "global-entity",
			relationshipSchemaSlug: "owner-link",
			relationshipSchemaPluginKey:
				input.relationshipKey === undefined ? "owner-key" : input.relationshipKey,
			createdAt: "2026-08-23T12:00:00.000Z",
		},
	],
});

const provenanceEntityDefinition: DefinitionSnapshot["entitySchemas"][string] = {
	icon: "box",
	pluginId: "owner-id",
	pluginSlug: "owner",
	name: "Owner entity",
	slug: "owner-entity",
	mergeIdentityProperties: [],
	propertiesSchema: { fields: {} },
	eventSchemas: {
		changed: {
			name: "Changed",
			slug: "changed",
			pluginId: "owner-id",
			propertiesSchema: { fields: {} },
		},
	},
};

const provenanceDefinitions: DefinitionSnapshot = {
	savedViews: {
		"owner-view": {
			layouts: provenanceLayouts,
			icon: "list",
			pluginId: "owner-id",
			pluginSlug: "owner",
			slug: "owner-view",
			name: "Owner view",
			sortOrder: 0,
			entitySchemaSlug: "owner-entity",
		},
	},
	entitySchemas: {
		"owner-entity": provenanceEntityDefinition,
	},
	signalSchemas: {
		"owner.signal": {
			catalogState: "active",
			pluginId: "owner-id",
			name: "Owner signal",
			slug: "owner.signal",
			propertiesSchema: { fields: {} },
			audiencePolicy: { kind: "actor" },
			notificationScriptSlug: "owner.notify",
		},
	},
	relationshipSchemas: {
		"owner-link": {
			pluginId: "owner-id",
			name: "Owner link",
			slug: "owner-link",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: "owner-entity",
			targetEntitySchemaSlug: "owner-entity",
		},
	},
};

const provenanceEvent = (eventSchemaPluginKey: string | null = "owner-key"): V2Event => ({
	properties: {},
	id: "event-id",
	sessionEntityId: null,
	eventSchemaSlug: "changed",
	entityId: "user-entity",
	eventSchemaPluginKey,
	createdAt: "2026-08-23T12:00:00.000Z",
	updatedAt: "2026-08-23T12:00:00.000Z",
	occurredAt: "2026-08-23T12:00:00.000Z",
});

it.effect("preflights all qualified schema provenance including streamed events", () =>
	Effect.gen(function* () {
		const pluginIds = new Map([
			["owner-key", "owner-id"],
			["foreign-key", "foreign-id"],
		]);
		const cases = [
			{
				name: "plugin-owned entity with null key",
				records: provenanceRecords({ entityKey: null }),
				event: provenanceEvent(),
			},
			{
				name: "plugin-owned relationship with null key",
				records: provenanceRecords({ relationshipKey: null }),
				event: provenanceEvent(),
			},
			{
				name: "plugin-owned builtin view with null key",
				records: provenanceRecords({ builtinView: true, viewKey: null }),
				event: provenanceEvent(),
			},
			{
				name: "plugin-owned subscription with null key",
				records: provenanceRecords({ subscriptionKey: null }),
				event: provenanceEvent(),
			},
			{
				name: "plugin-owned event with null key",
				records: provenanceRecords(),
				event: provenanceEvent(null),
			},
			{
				name: "kernel entity with plugin key",
				records: provenanceRecords(),
				event: provenanceEvent(),
				definitions: {
					...provenanceDefinitions,
					entitySchemas: {
						"owner-entity": {
							...provenanceEntityDefinition,
							pluginId: null,
						},
					},
				},
			},
			{
				name: "entity",
				records: provenanceRecords({ entityKey: "foreign-key" }),
				event: provenanceEvent(),
			},
			{
				name: "unmanaged dependency",
				records: provenanceRecords({ dependencyKey: "foreign-key" }),
				event: provenanceEvent(),
			},
			{
				name: "relationship",
				records: provenanceRecords({ relationshipKey: "foreign-key" }),
				event: provenanceEvent(),
			},
			{
				name: "saved view",
				records: provenanceRecords({ viewKey: "foreign-key" }),
				event: provenanceEvent(),
			},
			{
				name: "subscription",
				records: provenanceRecords({ subscriptionKey: "foreign-key" }),
				event: provenanceEvent(),
			},
			{
				name: "event",
				records: provenanceRecords(),
				event: provenanceEvent("foreign-key"),
			},
			{
				name: "undeclared event key",
				records: provenanceRecords(),
				event: provenanceEvent("undeclared-key"),
			},
		] as const;
		for (const testCase of cases) {
			const error = yield* preflightV2Provenance(
				testCase.records,
				{ count: 1, sha256: "", read: () => Stream.make(testCase.event) },
				pluginIds,
				"definitions" in testCase ? testCase.definitions : provenanceDefinitions,
			).pipe(Effect.flip);
			expect(error.message, testCase.name).toMatch(/wrong plugin owner|unmapped plugin key/);
		}
	}),
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
	expect(selectV2TranslationsForRestore(false, translations)).toEqual([]);
	expect(selectV2TranslationsForRestore(true, translations)).toBe(translations);
});

const mockEvents = Layer.mock(EventsRepository);
type RestoreEventsMock = NonNullable<MockOverrides<typeof mockEvents>["restoreEvents"]>;

const eventSchema = { name: "Review", slug: "review", propertiesSchema: { fields: {} } };
const bootstrapEntitySchema = {
	icon: "book",
	pluginSlug: "media",
	mergeIdentityProperties: [],
	name: V2_BOOTSTRAP_SOURCE.name,
	propertiesSchema: { fields: {} },
	eventSchemas: { review: eventSchema },
	slug: V2_BOOTSTRAP_SOURCE.entitySchemaSlug,
};

const archivedEvent = (id: string): V2Event => ({
	id,
	properties: {},
	sessionEntityId: null,
	eventSchemaSlug: "review",
	eventSchemaPluginKey: null,
	entityId: "archived-library",
	createdAt: "2026-08-23T12:00:00.000Z",
	updatedAt: "2026-08-23T12:00:00.000Z",
	occurredAt: "2026-08-23T12:00:00.000Z",
});

const restoreArchivedEvents = (events: ReadonlyArray<V2Event>, restoreEvents: RestoreEventsMock) =>
	Effect.gen(function* () {
		const writer = yield* BackupRestoreWriter;
		return yield* writer.restoreRecords(
			UserId.make("user-id"),
			{
				savedViews: [],
				integrations: [],
				installations: [],
				relationships: [],
				privatePlugins: [],
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
						entitySchemaPluginKey: null,
						name: V2_BOOTSTRAP_SOURCE.name,
						createdAt: "2026-08-23T12:00:00.000Z",
						updatedAt: "2026-08-23T12:00:00.000Z",
						entitySchemaSlug: V2_BOOTSTRAP_SOURCE.entitySchemaSlug,
					},
				],
			},
			new Map(),
			{ count: events.length, sha256: "", read: () => Stream.fromIterable(events) },
			new Map(),
			{
				savedViews: {},
				signalSchemas: {},
				relationshipSchemas: {},
				entitySchemas: { [V2_BOOTSTRAP_SOURCE.entitySchemaSlug]: bootstrapEntitySchema },
			},
		);
	}).pipe(
		Effect.provide(
			BackupRestoreWriter.layer.pipe(
				Layer.provideMerge(
					Layer.mergeAll(
						Layer.mock(PluginRepository, {
							listPrivateForUser: () => Effect.succeed([]),
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
										entitySchemaPluginId: null,
										name: V2_BOOTSTRAP_SOURCE.name,
										createdAt: new Date("2026-08-23T12:00:00.000Z"),
										updatedAt: new Date("2026-08-23T12:00:00.000Z"),
										entitySchemaSlug: V2_BOOTSTRAP_SOURCE.entitySchemaSlug,
									},
								]),
						}),
						Layer.mock(SavedViewsRepository, { restoreBuiltinViews: () => Effect.void }),
						Layer.mock(IntegrationsRepository, {}),
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
