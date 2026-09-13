import { assert, describe, expect, it } from "@effect/vitest";
import { DbError } from "@ryot-app/contract/errors";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import { ascending, column, document, field, rows, table } from "@ryot-app/ryotql";
import { count, eq } from "drizzle-orm";
import { Effect, Layer, Stream } from "effect";

import * as tables from "#lib/infrastructure/db/schema/tables/combined";
import { Database } from "#lib/infrastructure/db/service";
import { makeAppConfigLayer, type MockOverrides } from "#lib/test-utils/effect";
import { AuthRepository } from "#modules/auth/repository";
import { AutomationsRepository } from "#modules/automations/repository";
import {
	buildDefinitionSnapshot,
	type DefinitionSnapshot,
} from "#modules/definition-registry/snapshot";
import { mergeManifestDefinitions } from "#modules/definition-registry/source";
import { EntitiesRepository } from "#modules/entities/repository";
import { TranslationsRepository } from "#modules/entity-translation/repository";
import { EventsRepository, RESTORE_EVENT_BATCH_SIZE } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginInstallationRepository } from "#modules/plugins/installation-repository";
import { pluginSourceHash } from "#modules/plugins/pipeline";
import { PluginRepository } from "#modules/plugins/repository";
import { revisionPackage, withRevisionDatabase } from "#modules/plugins/revision.test-support";
import type { NormalizedPlugin } from "#modules/plugins/types";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { validateSavedViewDefinition } from "#modules/saved-views/definition-validation";
import { SavedViewsRepository } from "#modules/saved-views/repository";

import type { ArchiveEvent, ArchiveRecords } from "../archive/schemas";
import {
	assertDependencySchemaOwnership,
	BackupRestoreWriter,
	preflightProvenance,
	resolveBootstrapEntityMappings,
	resolveRestoredIntegrationDisabled,
	resolveRestoredInstallationLifecycle,
	resolveRequiredPluginIds,
	selectTranslationsForRestore,
} from "./writer";

it("keeps restored installations inactive when required secrets were redacted", () => {
	expect(
		resolveRestoredInstallationLifecycle(
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
			false,
		),
	).toEqual({ isDisabled: true, health: "needs-configuration" });
});

it("preserves needs-configuration health when the secret was already absent", () => {
	expect(
		resolveRestoredInstallationLifecycle(
			{ disabledIntent: true, configuredSecretPaths: [], lifecycleIntent: "needs-configuration" },
			{ fields: {}, unknownKeys: "strict" },
			false,
		),
	).toEqual({ isDisabled: true, health: "needs-configuration" });
});

it.effect("requires an exact system plugin version and source hash", () =>
	Effect.gen(function* () {
		const required = [{ slug: "system", version: "1.0.0", sourceHash: "a".repeat(64) }];
		const installed = [
			{ slug: "system", id: "plugin-id", version: "1.0.0", sourceHash: "b".repeat(64) },
		];
		const error = yield* resolveRequiredPluginIds(required, installed).pipe(Effect.flip);
		expect(error).toMatchObject({ pluginSlug: "system", requiredVersion: "1.0.0" });
	}),
);

it("detects nested required installation secrets in objects and arrays", () => {
	const schema = {
		unknownKeys: "strict" as const,
		fields: {
			credentials: {
				label: "Credentials",
				type: "object" as const,
				description: "Credentials",
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
							validation: { required: true as const },
						},
					},
				},
			},
		},
	} satisfies AppSchema;
	for (const path of ["/credentials/token", "/accounts/0/token"]) {
		expect(
			resolveRestoredInstallationLifecycle(
				{ disabledIntent: false, lifecycleIntent: "ready", configuredSecretPaths: [path] },
				schema,
				false,
			),
		).toEqual({ isDisabled: true, health: "needs-configuration" });
		expect(
			resolveRestoredIntegrationDisabled(
				{ isDisabled: false, configuredSecretPaths: [path] },
				schema,
			),
		).toBe(true);
	}
});

it.effect("rejects a crafted provider dependency whose schema belongs to another plugin", () =>
	assertDependencySchemaOwnership(
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
			provider: { providerSlug: "provider", pluginKey: "provider-owner" },
			identity: { kind: "provider", providerSlug: "provider", pluginKey: "provider-owner" },
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
const provenanceRecords = (
	input: {
		readonly builtinView?: boolean;
		readonly viewKey?: string | null;
		readonly entityKey?: string | null;
		readonly dependencyKey?: string | null;
		readonly relationshipKey?: string | null;
		readonly subscriptionKey?: string | null;
	} = {},
): ArchiveRecords => ({
	integrations: [],
	installations: [],
	privatePlugins: [],
	profile: { image: null, name: "User", preferences: {} },
	notificationSubscriptions: [
		{
			metadata: null,
			isActive: false,
			signalSchemaSlug: "owner.signal",
			signalSchemaPluginKey:
				input.subscriptionKey === undefined ? "owner-key" : input.subscriptionKey,
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
	entities: [
		{
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
	savedViews: [
		input.builtinView
			? {
					sortOrder: 0,
					isBuiltin: true,
					isDisabled: false,
					slug: "owner-view",
					id: "saved-view-id",
					kind: "builtin-override",
					pluginKey: input.viewKey === undefined ? "owner-key" : input.viewKey,
				}
			: {
					sortOrder: 0,
					settings: {},
					icon: "list",
					kind: "custom",
					isBuiltin: false,
					isDisabled: false,
					slug: "owner-view",
					name: "Owner view",
					id: "saved-view-id",
					dataSources: provenanceQuery,
					createdAt: "2026-08-23T12:00:00.000Z",
					updatedAt: "2026-08-23T12:00:00.000Z",
					renderer: { kind: "kernel", name: "entity-browser" },
					pluginKey: input.viewKey === undefined ? "owner-key" : input.viewKey,
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
	signalSchemas: {
		"owner.signal": {
			pluginId: "owner-id",
			name: "Owner signal",
			slug: "owner.signal",
			catalogState: "active",
			propertiesSchema: { fields: {} },
			audiencePolicy: { kind: "actor" },
			notificationHookSlug: "owner.notify",
		},
	},
	savedViews: {
		"owner-view": {
			icon: "list",
			sortOrder: 0,
			settings: {},
			slug: "owner-view",
			name: "Owner view",
			pluginSlug: "owner",
			pluginId: "owner-id",
			dataSources: provenanceQuery,
			renderer: { kind: "kernel", name: "entity-browser" },
		},
	},
};

const provenanceEvent = (eventSchemaPluginKey: string | null = "owner-key"): ArchiveEvent => ({
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
				records: provenanceRecords({ viewKey: null, builtinView: true }),
			},
			{
				event: provenanceEvent(),
				name: "plugin-owned subscription with null key",
				records: provenanceRecords({ subscriptionKey: null }),
			},
			{
				records: provenanceRecords(),
				event: provenanceEvent(null),
				name: "plugin-owned event with null key",
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
				name: "subscription",
				event: provenanceEvent(),
				records: provenanceRecords({ subscriptionKey: "foreign-key" }),
			},
			{ name: "event", records: provenanceRecords(), event: provenanceEvent("foreign-key") },
			{
				name: "undeclared event key",
				records: provenanceRecords(),
				event: provenanceEvent("undeclared-key"),
			},
		] as const;
		for (const testCase of cases) {
			const error = yield* preflightProvenance(
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
	expect(selectTranslationsForRestore(false, translations)).toEqual([]);
	expect(selectTranslationsForRestore(true, translations)).toBe(translations);
});

it.effect(
	"rejects structurally valid restored plugin views with incompatible settings or data sources",
	() =>
		Effect.gen(function* () {
			const renderer = { exportName: "page", pluginId: "plugin-id", kind: "plugin" as const };
			const page = {
				settingsSchema: {
					unknownKeys: "strict" as const,
					fields: {
						label: {
							label: "Label",
							description: "Label",
							type: "string" as const,
							validation: { required: true },
						},
					},
				} satisfies AppSchema,
			};
			const settingsError = yield* validateSavedViewDefinition(
				renderer,
				{ label: 42 },
				provenanceQuery,
				null,
				page,
			).pipe(Effect.flip);
			expect(settingsError.reason.code).toBe("settings-incompatible");

			const invalidTable = table("missing-table", "missing");
			const sourceError = yield* validateSavedViewDefinition(
				renderer,
				{ label: "valid" },
				document({ invalid: rows(invalidTable, { fields: [] }) }),
				null,
				page,
			).pipe(Effect.flip);
			expect(sourceError.reason).toMatchObject({ code: "settings-incompatible" });
		}),
);

it.effect("rejects unavailable plugin renderers through the canonical rule", () =>
	validateSavedViewDefinition(
		{ kind: "plugin", exportName: "page", pluginId: "plugin-id" },
		{},
		provenanceQuery,
		null,
	).pipe(
		Effect.flip,
		Effect.tap((error) => Effect.sync(() => expect(error.reason.code).toBe("renderer-not-found"))),
	),
);

const mockEvents = Layer.mock(EventsRepository);
type RestoreEventsMock = NonNullable<MockOverrides<typeof mockEvents>["restoreEvents"]>;
const mockEntities = Layer.mock(EntitiesRepository);
type RestoreEntityMock = NonNullable<MockOverrides<typeof mockEntities>["restoreEntity"]>;

const eventSchema = { name: "Review", slug: "review", propertiesSchema: { fields: {} } };
const bootstrapEntitySchema = {
	icon: "record",
	pluginSlug: "fixture",
	name: "Bootstrap entity",
	slug: "bootstrap-entity",
	mergeIdentityProperties: [],
	propertiesSchema: { fields: {} },
	eventSchemas: { review: eventSchema },
};

const archivedEvent = (id: string): ArchiveEvent => ({
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

const restoreArchivedEvents = (
	events: ReadonlyArray<ArchiveEvent>,
	restoreEvents: RestoreEventsMock,
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
				profile: { image: null, name: "User", preferences: {} },
				entities: [
					{
						properties: {},
						provider: null,
						externalId: null,
						populatedAt: null,
						id: "archived-bootstrap",
						name: "Bootstrap entity",
						entitySchemaPluginKey: null,
						entitySchemaSlug: "bootstrap-entity",
						createdAt: "2026-08-23T12:00:00.000Z",
						updatedAt: "2026-08-23T12:00:00.000Z",
					},
				],
			},
			new Map(),
			{ sha256: "", count: events.length, read: () => Stream.fromIterable(events) },
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
							restoreEntity,
							listUserEntitiesForBackup: () => Effect.succeed([]),
						}),
						Layer.mock(SavedViewsRepository, {}),
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

const bootstrapEntity = (
	id: string,
	overrides: Partial<
		Pick<
			ArchiveRecords["entities"][number],
			"entitySchemaPluginKey" | "entitySchemaSlug" | "name" | "properties" | "externalId"
		>
	> = {},
) => ({
	id,
	provider: null,
	externalId: null,
	name: "Arbitrary name",
	properties: { arbitrary: true },
	entitySchemaPluginKey: "plugin-key",
	entitySchemaSlug: "arbitrary-schema",
	...overrides,
});

const targetBootstrapEntity = (
	id: string,
	entitySchemaPluginId: string,
	overrides: Parameters<typeof bootstrapEntity>[1] = {},
) => ({ ...bootstrapEntity(id, overrides), provider: null, entitySchemaPluginId });

it.effect("maps bootstrap entities by schema and plugin ownership", () =>
	Effect.gen(function* () {
		expect(
			yield* resolveBootstrapEntityMappings(
				[
					bootstrapEntity("archived-bootstrap"),
					bootstrapEntity("unrelated-bootstrap", {
						properties: {},
						name: "Another entity",
						entitySchemaPluginKey: null,
						entitySchemaSlug: "another-schema",
					}),
				],
				[targetBootstrapEntity("target-bootstrap", "target-plugin-id")],
				new Map([["plugin-key", "target-plugin-id"]]),
			),
		).toEqual(new Map([["archived-bootstrap", "target-bootstrap"]]));
	}),
);

it.effect("does not map provider-backed or externally identified rows", () =>
	Effect.gen(function* () {
		expect(
			yield* resolveBootstrapEntityMappings(
				[
					bootstrapEntity("archived-bootstrap"),
					bootstrapEntity("archived-other-plugin", { entitySchemaPluginKey: "other-key" }),
					bootstrapEntity("archived-provenanced", { externalId: "external" }),
				],
				[
					targetBootstrapEntity("target-bootstrap", "target-plugin-id"),
					targetBootstrapEntity("target-other-plugin", "other-plugin-id"),
					targetBootstrapEntity("target-provenanced", "target-plugin-id", {
						externalId: "external",
					}),
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
	resolveBootstrapEntityMappings(
		[bootstrapEntity("archived")],
		[],
		new Map([["plugin-key", "plugin-id"]]),
	).pipe(Effect.map((mappings) => expect(mappings).toEqual(new Map()))),
);

it.effect("rejects ambiguous bootstrap identities", () =>
	resolveBootstrapEntityMappings(
		[bootstrapEntity("archived")],
		[targetBootstrapEntity("first", "plugin-id"), targetBootstrapEntity("second", "plugin-id")],
		new Map([["plugin-key", "plugin-id"]]),
	).pipe(
		Effect.flip,
		Effect.tap((error) => Effect.sync(() => expect(error.message).toContain("ambiguous"))),
	),
);

it.effect("restores an archived entity without origin metadata", () => {
	let restored: unknown;
	return restoreArchivedEvents(
		[],
		() => Effect.void,
		(input) =>
			Effect.sync(() => {
				restored = input;
				return EntityId.make(input.id ?? "restored");
			}),
	).pipe(
		Effect.tap(() =>
			Effect.sync(() => {
				expect(restored).toMatchObject({ id: "archived-bootstrap" });
				expect(restored).not.toHaveProperty("origin");
			}),
		),
	);
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

describe("account backup restore in PostgreSQL", () => {
	it.effect(
		"restores redacted required private config and historical records without automation history",
		() => {
			const dependencies = Layer.mergeAll(
				AuthRepository.layer,
				EventsRepository.layer,
				EntitiesRepository.layer,
				PluginRepository.layer,
				SavedViewsRepository.layer,
				IntegrationsRepository.layer,
				AutomationsRepository.layer,
				TranslationsRepository.layer,
				RelationshipsRepository.layer,
				PluginInstallationRepository.layer,
			).pipe(Layer.provide(makeAppConfigLayer()));
			const writerLayer = BackupRestoreWriter.layer.pipe(Layer.provideMerge(dependencies));
			return withRevisionDatabase(
				Effect.gen(function* () {
					const db = yield* Database;
					const plugins = yield* PluginRepository;
					const installations = yield* PluginInstallationRepository;
					const basePackage = revisionPackage("portable", "v1", "portable-entity");
					const primarySignal = basePackage.manifest.signalSchemas[0];
					assert(primarySignal);
					const manifest: PluginManifest = {
						...basePackage.manifest,
						signalSchemas: [
							primarySignal,
							{ ...primarySignal, name: "Other signal", slug: "portable.other-signal" },
						],
						configSchema: {
							unknownKeys: "strict",
							fields: {
								unit: { label: "Unit", type: "string", description: "Unit" },
								token: {
									secret: true,
									type: "string",
									label: "Token",
									description: "Private token",
									validation: { required: true },
								},
							},
						},
						hooks: basePackage.manifest.hooks.map((hook) =>
							hook.slug === primarySignal.notificationHookSlug
								? {
										...hook,
										targets: [
											...hook.targets,
											{
												operation: "emit" as const,
												resource: "signal" as const,
												signalSchemaSlug: "portable.other-signal",
											},
										],
									}
								: hook,
						),
					};
					const packageValue: NormalizedPlugin = {
						...basePackage,
						manifest,
						sourceHash: pluginSourceHash(
							manifest,
							basePackage.files,
							basePackage.scripts.map(({ entry, source, compiledCode, compiledFormat }) => ({
								entry,
								source,
								format: compiledFormat,
								javascript: compiledCode,
							})),
							basePackage.compiledClient,
						),
					};
					const pluginId = yield* plugins.persist(packageValue, {
						scope: "user",
						slug: "portable",
						ownerId: "recipient",
					});
					const pluginKey = `user:portable:${packageValue.sourceHash}`;
					const snapshot = buildDefinitionSnapshot(
						mergeManifestDefinitions(
							{ savedViews: [], signalSchemas: [], entitySchemas: [], relationshipSchemas: [] },
							[{ id: pluginId, slug: "portable", manifest: packageValue.manifest }],
						),
					);
					const timestamp = "2026-09-16T00:00:00.000Z";
					const records: ArchiveRecords = {
						savedViews: [],
						integrations: [],
						privatePlugins: [],
						entityDependencies: [],
						profile: { image: null, preferences: {}, name: "Restored" },
						notificationSubscriptions: [
							{
								metadata: null,
								isActive: false,
								signalSchemaPluginKey: pluginKey,
								signalSchemaSlug: "portable.signal",
							},
						],
						relationships: [
							{
								scope: "user",
								properties: {},
								createdAt: timestamp,
								id: "restored-relationship",
								sourceEntityId: "restored-entity",
								targetEntityId: "restored-entity",
								relationshipSchemaPluginKey: pluginKey,
								relationshipSchemaSlug: "portable-link",
							},
						],
						entities: [
							{
								properties: {},
								provider: null,
								externalId: null,
								populatedAt: null,
								createdAt: timestamp,
								updatedAt: timestamp,
								id: "restored-entity",
								name: "Restored entity",
								entitySchemaPluginKey: pluginKey,
								entitySchemaSlug: "portable-entity",
							},
						],
						installations: [
							{
								sortOrder: 1,
								createdAt: timestamp,
								updatedAt: timestamp,
								disabledIntent: false,
								packageKey: pluginKey,
								homeSavedViewSlug: null,
								lifecycleIntent: "ready",
								config: { unit: "metric" },
								id: "restored-installation",
								configuredSecretPaths: ["/token"],
							},
						],
					};
					const archivedEvents = {
						count: 1,
						sha256: "unused",
						read: () =>
							Stream.make({
								properties: {},
								id: "restored-event",
								createdAt: timestamp,
								updatedAt: timestamp,
								sessionEntityId: null,
								occurredAt: timestamp,
								eventSchemaSlug: "changed",
								entityId: "restored-entity",
								eventSchemaPluginKey: pluginKey,
							}),
					};
					const writer = yield* BackupRestoreWriter;
					yield* writer.restoreRecords(
						UserId.make("recipient"),
						records,
						new Map(),
						archivedEvents,
						new Map([[pluginKey, pluginId]]),
						snapshot,
					);
					const restoredInstallation = yield* installations.findByUserAndPlugin(
						UserId.make("recipient"),
						pluginId,
					);
					assert(restoredInstallation?.activeConfigRevisionId);
					expect(restoredInstallation).toMatchObject({
						isDisabled: true,
						health: "needs-configuration",
					});
					expect(restoredInstallation.config).toEqual({ unit: "metric" });
					const [configRevision] = yield* db
						.select()
						.from(tables.pluginConfigRevision)
						.where(eq(tables.pluginConfigRevision.id, restoredInstallation.activeConfigRevisionId));
					const [encryptionKey] = yield* db.select().from(tables.pluginConfigEncryptionKey);
					assert(configRevision?.encryptedPayload);
					assert(encryptionKey);
					expect(configRevision.encryptionKeyId).toBe(encryptionKey.id);
					expect(new TextDecoder().decode(configRevision.encryptedPayload)).not.toContain("metric");
					expect(records.installations[0]?.config).not.toHaveProperty("token");
					expect(records.installations[0]).not.toHaveProperty("activeConfigRevisionId");
					expect(yield* db.select().from(tables.pluginConfigRevision)).toHaveLength(1);
					const subscriptions = yield* db
						.select()
						.from(tables.notificationSubscription)
						.where(eq(tables.notificationSubscription.userId, "recipient"));
					expect(
						subscriptions
							.map(({ isActive, signalSchemaSlug }) => ({ isActive, signalSchemaSlug }))
							.sort((left, right) => left.signalSchemaSlug.localeCompare(right.signalSchemaSlug)),
					).toEqual([
						{ isActive: true, signalSchemaSlug: "portable.other-signal" },
						{ isActive: false, signalSchemaSlug: "portable.signal" },
					]);
					for (const tableName of [
						tables.automationTrigger,
						tables.automationTriggerRecipient,
						tables.automationRun,
						tables.automationRunAttempt,
					]) {
						const [row] = yield* db.select({ count: count() }).from(tableName);
						expect(row?.count).toBe(0);
					}
				}).pipe(Effect.provide(writerLayer)),
			);
		},
	);
});
