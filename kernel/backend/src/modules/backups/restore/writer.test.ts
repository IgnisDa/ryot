import { expect, it } from "@effect/vitest";
import { DbError } from "@ryot/contract/errors";
import type { SavedViewLayouts } from "@ryot/contract/modules/saved-views/schemas";
import { EntityId, UserId } from "@ryot/contract/schema/brands";
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

import type { V2ArchiveRecords, V2Event } from "../archive-v2/schemas";
import {
	assertV2DependencySchemaOwnership,
	BackupRestoreWriter,
	preflightV2Provenance,
	resolveV2BootstrapEntityMappings,
	resolveV2RestoredIntegrationDisabled,
	resolveV2RestoredInstallationLifecycle,
	resolveV2RequiredPluginIds,
	selectV2TranslationsForRestore,
} from "./writer";

it("keeps restored installations inactive when required secrets were redacted", () => {
	expect(
		resolveV2RestoredInstallationLifecycle(
			{ disabledIntent: false, lifecycleIntent: "ready", configuredSecretPaths: ["/token"] },
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
				label: "Accounts",
				type: "array" as const,
				description: "Accounts",
				items: {
					label: "Account",
					description: "Account",
					type: "object" as const,
					properties: {
						token: {
							label: "Token",
							description: "Token",
							secret: true as const,
							type: "string" as const,
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

const bootstrapEntity = (
	id: string,
	overrides: Partial<
		Pick<
			V2ArchiveRecords["entities"][number],
			| "origin"
			| "entitySchemaPluginKey"
			| "entitySchemaSlug"
			| "name"
			| "properties"
			| "provider"
			| "externalId"
		>
	> = {},
) => ({
	id,
	provider: null,
	name: "Arbitrary name",
	properties: { arbitrary: true },
	externalId: "arbitrary-external-id",
	entitySchemaSlug: "arbitrary-schema",
	entitySchemaPluginKey: "plugin-key",
	origin: { kind: "bootstrap" as const },
	...overrides,
});

it.effect("maps bootstrap entities by schema and plugin ownership", () =>
	Effect.gen(function* () {
		expect(
			yield* resolveV2BootstrapEntityMappings(
				[
					bootstrapEntity("archived-bootstrap"),
					bootstrapEntity("unrelated-bootstrap", {
						properties: {},
						externalId: null,
						name: "Another entity",
						entitySchemaPluginKey: null,
						entitySchemaSlug: "another-schema",
					}),
				],
				[{ ...bootstrapEntity("target-bootstrap"), entitySchemaPluginId: "target-plugin-id" }],
				new Map([["plugin-key", "target-plugin-id"]]),
			),
		).toEqual(new Map([["archived-bootstrap", "target-bootstrap"]]));
	}),
);

it.effect("does not map non-bootstrap entities or structurally similar rows", () =>
	Effect.gen(function* () {
		expect(
			yield* resolveV2BootstrapEntityMappings(
				[
					bootstrapEntity("archived-bootstrap"),
					bootstrapEntity("archived-other-plugin", { entitySchemaPluginKey: "other-key" }),
					bootstrapEntity("archived-non-bootstrap", { origin: { kind: "api" } }),
				],
				[
					{ ...bootstrapEntity("target-bootstrap"), entitySchemaPluginId: "target-plugin-id" },
					{ ...bootstrapEntity("target-other-plugin"), entitySchemaPluginId: "other-plugin-id" },
					{
						...bootstrapEntity("target-non-bootstrap", { origin: { kind: "api" } }),
						entitySchemaPluginId: "target-plugin-id",
					},
				],
				new Map([
					["plugin-key", "target-plugin-id"],
					["other-key", "other-archive-plugin-id"],
				]),
			),
		).toEqual(new Map([["archived-bootstrap", "target-bootstrap"]]));
	}),
);

it.effect("restores unmatched archived bootstrap entities", () =>
	resolveV2BootstrapEntityMappings(
		[bootstrapEntity("archived")],
		[],
		new Map([["plugin-key", "plugin-id"]]),
	).pipe(Effect.map((mappings) => expect(mappings).toEqual(new Map()))),
);

it.effect("rejects ambiguous target bootstrap identities", () =>
	resolveV2BootstrapEntityMappings(
		[bootstrapEntity("archived")],
		[
			{ ...bootstrapEntity("first"), entitySchemaPluginId: "plugin-id" },
			{ ...bootstrapEntity("second"), entitySchemaPluginId: "plugin-id" },
		],
		new Map([["plugin-key", "plugin-id"]]),
	).pipe(
		Effect.flip,
		Effect.tap((error) => Effect.sync(() => expect(error.message).toContain("ambiguous"))),
	),
);

it.effect("rejects ambiguous archived or target bootstrap identities", () =>
	resolveV2BootstrapEntityMappings(
		[bootstrapEntity("first"), bootstrapEntity("second")],
		[{ ...bootstrapEntity("target"), entitySchemaPluginId: "target-plugin-id" }],
		new Map([["plugin-key", "target-plugin-id"]]),
	).pipe(
		Effect.flip,
		Effect.tap((error) => Effect.sync(() => expect(error.message).toContain("ambiguous"))),
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
			createdAt: "2026-08-23T12:00:00.000Z",
			updatedAt: "2026-08-23T12:00:00.000Z",
			entitySchemaPluginKey: "provider-owner",
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
			origin: null,
			properties: {},
			provider: null,
			externalId: null,
			populatedAt: null,
			id: "user-entity",
			name: "User entity",
			entitySchemaSlug: "owner-entity",
			createdAt: "2026-08-23T12:00:00.000Z",
			updatedAt: "2026-08-23T12:00:00.000Z",
			entitySchemaPluginKey: input.entityKey === undefined ? "owner-key" : input.entityKey,
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
			createdAt: "2026-08-23T12:00:00.000Z",
			updatedAt: "2026-08-23T12:00:00.000Z",
			entitySchemaPluginKey: input.dependencyKey === undefined ? "owner-key" : input.dependencyKey,
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
			createdAt: "2026-08-23T12:00:00.000Z",
			relationshipSchemaPluginKey:
				input.relationshipKey === undefined ? "owner-key" : input.relationshipKey,
		},
	],
});

const provenanceEntityDefinition: DefinitionSnapshot["entitySchemas"][string] = {
	icon: "box",
	pluginSlug: "owner",
	name: "Owner entity",
	slug: "owner-entity",
	pluginId: "owner-id",
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
	entitySchemas: { "owner-entity": provenanceEntityDefinition },
	savedViews: {
		"owner-view": {
			icon: "list",
			sortOrder: 0,
			slug: "owner-view",
			name: "Owner view",
			pluginSlug: "owner",
			pluginId: "owner-id",
			layouts: provenanceLayouts,
			entitySchemaSlug: "owner-entity",
		},
	},
	signalSchemas: {
		"owner.signal": {
			pluginId: "owner-id",
			name: "Owner signal",
			slug: "owner.signal",
			catalogState: "active",
			propertiesSchema: { fields: {} },
			audiencePolicy: { kind: "actor" },
			notificationScriptSlug: "owner.notify",
		},
	},
	relationshipSchemas: {
		"owner-link": {
			name: "Owner link",
			slug: "owner-link",
			pluginId: "owner-id",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: "owner-entity",
			targetEntitySchemaSlug: "owner-entity",
		},
	},
};

const provenanceEvent = (eventSchemaPluginKey: string | null = "owner-key"): V2Event => ({
	properties: {},
	id: "event-id",
	eventSchemaPluginKey,
	sessionEntityId: null,
	entityId: "user-entity",
	eventSchemaSlug: "changed",
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
				event: provenanceEvent(),
				name: "plugin-owned entity with null key",
				records: provenanceRecords({ entityKey: null }),
			},
			{
				event: provenanceEvent(),
				name: "plugin-owned relationship with null key",
				records: provenanceRecords({ relationshipKey: null }),
			},
			{
				event: provenanceEvent(),
				name: "plugin-owned builtin view with null key",
				records: provenanceRecords({ builtinView: true, viewKey: null }),
			},
			{
				event: provenanceEvent(),
				name: "plugin-owned subscription with null key",
				records: provenanceRecords({ subscriptionKey: null }),
			},
			{
				records: provenanceRecords(),
				name: "plugin-owned event with null key",
				event: provenanceEvent(null),
			},
			{
				event: provenanceEvent(),
				records: provenanceRecords(),
				name: "kernel entity with plugin key",
				definitions: {
					...provenanceDefinitions,
					entitySchemas: { "owner-entity": { ...provenanceEntityDefinition, pluginId: null } },
				},
			},
			{
				name: "entity",
				event: provenanceEvent(),
				records: provenanceRecords({ entityKey: "foreign-key" }),
			},
			{
				event: provenanceEvent(),
				name: "unmanaged dependency",
				records: provenanceRecords({ dependencyKey: "foreign-key" }),
			},
			{
				name: "relationship",
				event: provenanceEvent(),
				records: provenanceRecords({ relationshipKey: "foreign-key" }),
			},
			{
				name: "saved view",
				event: provenanceEvent(),
				records: provenanceRecords({ viewKey: "foreign-key" }),
			},
			{
				name: "subscription",
				event: provenanceEvent(),
				records: provenanceRecords({ subscriptionKey: "foreign-key" }),
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
const mockEntities = Layer.mock(EntitiesRepository);
type RestoreEntityMock = NonNullable<MockOverrides<typeof mockEntities>["restoreEntity"]>;

const eventSchema = { name: "Review", slug: "review", propertiesSchema: { fields: {} } };
const bootstrapEntitySchema = {
	icon: "book",
	pluginSlug: "fixture",
	name: "Bootstrap entity",
	slug: "bootstrap-entity",
	mergeIdentityProperties: [],
	propertiesSchema: { fields: {} },
	eventSchemas: { review: eventSchema },
};

const archivedEvent = (id: string): V2Event => ({
	id,
	properties: {},
	sessionEntityId: null,
	eventSchemaSlug: "review",
	eventSchemaPluginKey: null,
	entityId: "archived-bootstrap",
	createdAt: "2026-08-23T12:00:00.000Z",
	updatedAt: "2026-08-23T12:00:00.000Z",
	occurredAt: "2026-08-23T12:00:00.000Z",
});

const targetBootstrapEntity = {
	properties: {},
	provider: null,
	externalId: null,
	populatedAt: null,
	id: "target-bootstrap",
	name: "Bootstrap entity",
	entitySchemaPluginId: null,
	entitySchemaSlug: "bootstrap-entity",
	origin: { kind: "bootstrap" as const },
	createdAt: new Date("2026-08-23T12:00:00.000Z"),
	updatedAt: new Date("2026-08-23T12:00:00.000Z"),
};

const restoreArchivedEvents = (
	events: ReadonlyArray<V2Event>,
	restoreEvents: RestoreEventsMock,
	targetEntities: ReadonlyArray<typeof targetBootstrapEntity> = [targetBootstrapEntity],
	restoreEntity: RestoreEntityMock = (input) =>
		Effect.succeed(EntityId.make(input.id ?? "restored")),
) =>
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
						id: "archived-bootstrap",
						name: "Bootstrap entity",
						entitySchemaPluginKey: null,
						origin: { kind: "bootstrap" },
						entitySchemaSlug: "bootstrap-entity",
						createdAt: "2026-08-23T12:00:00.000Z",
						updatedAt: "2026-08-23T12:00:00.000Z",
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
				entitySchemas: { "bootstrap-entity": bootstrapEntitySchema },
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
							listUserEntitiesForBackup: () => Effect.succeed([...targetEntities]),
							restoreEntity,
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

it.effect("restores an unmatched bootstrap entity with its origin", () => {
	let origin: unknown;
	return restoreArchivedEvents(
		[],
		() => Effect.void,
		[],
		(input) =>
			Effect.sync(() => {
				origin = input.origin;
				return EntityId.make(input.id ?? "restored");
			}),
	).pipe(Effect.tap(() => Effect.sync(() => expect(origin).toEqual({ kind: "bootstrap" }))));
});

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
