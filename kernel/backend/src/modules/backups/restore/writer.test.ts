import { BunFileSystem } from "@effect/platform-bun";
import { assert, describe, expect, it, layer } from "@effect/vitest";
import { badRequest, DbError } from "@ryot-app/contract/errors";
import { BackupBadRequest } from "@ryot-app/contract/modules/backups/schemas";
import { dataJsonSource } from "@ryot-app/contract/modules/imports/data-json";
import type { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import {
	definitionKey,
	definitionOwner,
	pluginPackageKey,
} from "@ryot-app/contract/modules/plugins/references";
import {
	EntityId,
	EntitySchemaSlug,
	PluginId,
	SavedViewId,
	SignalSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import type { AppSchema } from "@ryot-app/contract/schema/property-schema";
import {
	ascending,
	column,
	document,
	field,
	literal,
	pluginId,
	rows,
	table,
} from "@ryot-app/ryotql";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { count, eq, sql } from "drizzle-orm";
import { Context, Effect, FileSystem, Layer, Ref, Schema, Stream } from "effect";

import { managedAssetProperty } from "#lib/domain/managed-asset-writes.test-support";
import { AuthRepository } from "#modules/accounts/auth/repository";
import { ManagedAssetsService } from "#modules/assets/storage/managed-assets";
import { AutomationsRepository } from "#modules/automations/repository";
import { buildDefinitionSnapshot, type DefinitionSnapshot } from "#modules/definitions/snapshot";
import { mergeManifestDefinitions } from "#modules/definitions/source";
import { TranslationsRepository } from "#modules/entities/localization/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { EventsRepository, RESTORE_EVENT_BATCH_SIZE } from "#modules/events/repository";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { PluginInstallationRepository } from "#modules/plugins/installations/repository";
import { PluginBackupRestore } from "#modules/plugins/packages/backup-restore";
import {
	normalizePluginPackage,
	normalizePluginSource,
	pluginContentHash,
} from "#modules/plugins/packages/pipeline";
import { PluginRepository } from "#modules/plugins/packages/repository";
import {
	revisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import type { NormalizedPlugin, StoredPlugin } from "#modules/plugins/packages/types";
import { fixtureManifest } from "#modules/plugins/test-support";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { validateSavedViewDefinition } from "#modules/saved-views/definition-validation";
import { SavedViewsRepository } from "#modules/saved-views/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { fakeDatabaseSession, makeAppConfigLayer } from "#testing/effect";

import { createArchiveStream, validateArchiveStream } from "../archive/archive";
import {
	ArchiveEvent,
	archivePluginDefinitionContract,
	type ArchiveRecords,
} from "../archive/schemas";
import { BackupExportSnapshot } from "../export/snapshot";
import { BackupRestorePersistence } from "./persistence";
import {
	assertDependencySchemaOwnership,
	BackupRestoreWriter,
	preflightProvenance,
	resolveBootstrapEntityMappings,
	resolveRequiredPluginIds,
	resolveRestoredInstallationLifecycle,
	resolveRestoredIntegrationDisabled,
	resolveRestoredPluginUserSettings,
	selectTranslationsForRestore,
} from "./writer";

const manifestsByKey = (
	records: ReadonlyArray<{ readonly key: string; readonly manifest: PluginManifest }>,
) => Object.fromEntries(records.map(({ key, manifest }) => [key, stableStringify(manifest)]));

const fixedDate = new Date("2026-10-01T00:00:00.000Z");

it("keeps restored installations inactive when required secrets were redacted", () => {
	expect(
		resolveRestoredInstallationLifecycle(
			{
				healthReason: null,
				hiddenIntent: false,
				lifecycleIntent: "ready",
				incompatibilityReason: null,
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
			false,
			false,
		),
	).toEqual({
		isHidden: true,
		healthReason: null,
		incompatibilityReason: null,
		health: "needs-configuration",
	});
});

it.effect(
	"validates restored plugin user settings and permits empty settings without a schema",
	() =>
		Effect.gen(function* () {
			const settingsSchema: AppSchema = {
				unknownKeys: "strict",
				fields: {
					enabled: { type: "boolean", label: "Enabled", description: "Enable the preference" },
				},
			};
			expect(yield* resolveRestoredPluginUserSettings({ enabled: true }, settingsSchema)).toEqual({
				enabled: true,
			});
			expect(yield* resolveRestoredPluginUserSettings({}, undefined)).toEqual({});
			const invalid = yield* resolveRestoredPluginUserSettings({ enabled: true }, undefined).pipe(
				Effect.flip,
			);
			expect(invalid._tag).toBe("BadRequest");
			const invalidValue = yield* resolveRestoredPluginUserSettings(
				{ enabled: "yes" },
				settingsSchema,
			).pipe(Effect.flip);
			expect(invalidValue._tag).toBe("BadRequest");
		}),
);

it("preserves needs-configuration health when the secret was already absent", () => {
	expect(
		resolveRestoredInstallationLifecycle(
			{
				hiddenIntent: true,
				healthReason: null,
				configuredSecretPaths: [],
				incompatibilityReason: null,
				lifecycleIntent: "needs-configuration",
			},
			{ fields: {}, unknownKeys: "strict" },
			false,
			false,
		),
	).toEqual({
		isHidden: true,
		healthReason: null,
		incompatibilityReason: null,
		health: "needs-configuration",
	});
});

it.effect(
	"rejects a missing required system package without selecting a same-name private package",
	() =>
		Effect.gen(function* () {
			const source = revisionPackage("system", "1.0.0", "bottle");
			const packageId = source.manifest.metadata.packageId;
			const required = [
				{
					packageId,
					slug: "system",
					version: "1.0.0",
					contentHash: source.contentHash,
					definitionContract: archivePluginDefinitionContract(source.manifest),
				},
			];
			const installed = [
				{
					...source,
					packageId,
					slug: "system",
					id: "plugin-id",
					ownerId: "owner",
					status: "active",
					scope: "user" as const,
					activationId: "activation",
				},
			];
			const error = yield* resolveRequiredPluginIds(required, installed).pipe(Effect.flip);
			expect(error).toMatchObject({ packageId, requiredVersion: "1.0.0" });
		}),
);

it.effect(
	"binds a compatible system revision by package identity, not mutable name or revision text",
	() =>
		Effect.gen(function* () {
			const previous = revisionPackage("whiskey", "v1", "bottle");
			const packageId = previous.manifest.metadata.packageId;
			const next = revisionPackage("renamed", "v2", "bottle", packageId);
			const manifest = {
				...previous.manifest,
				metadata: next.manifest.metadata,
				entitySchemas: previous.manifest.entitySchemas.map((schema) => ({
					...schema,
					propertiesSchema: {
						...schema.propertiesSchema,
						fields: {
							...schema.propertiesSchema.fields,
							note: { label: "Note", description: "Note", type: "string" as const },
						},
					},
				})),
			};
			const installed = {
				...next,
				manifest,
				packageId,
				ownerId: null,
				slug: "renamed",
				status: "active",
				id: "verified-system",
				scope: "system" as const,
				activationId: "activation",
			};
			const required = [
				{
					packageId,
					version: "v1",
					slug: "whiskey",
					contentHash: previous.contentHash,
					definitionContract: archivePluginDefinitionContract(previous.manifest),
				},
			];
			expect([...(yield* resolveRequiredPluginIds(required, [installed]))]).toEqual([
				[pluginPackageKey({ packageId, scope: "system" }), "verified-system"],
			]);
			const incompatible = { ...installed, manifest: { ...manifest, entitySchemas: [] } };
			expect(
				(yield* resolveRequiredPluginIds(required, [incompatible]).pipe(Effect.flip)).packageId,
			).toBe(packageId);
		}),
);

it("preserves exported quarantine and hidden intent even when no system conflict remains", () => {
	const state = {
		hiddenIntent: false,
		configuredSecretPaths: [],
		healthReason: "Identity conflict",
		lifecycleIntent: "incompatible" as const,
		incompatibilityReason: "package-identity-conflict" as const,
	};
	expect(resolveRestoredInstallationLifecycle(state, { fields: {} }, false, false)).toEqual({
		isHidden: false,
		health: "incompatible",
		healthReason: "Identity conflict",
		incompatibilityReason: "package-identity-conflict",
	});
	expect(
		resolveRestoredInstallationLifecycle(
			{ ...state, hiddenIntent: true, lifecycleIntent: "ready", incompatibilityReason: null },
			{ fields: {} },
			false,
			true,
		),
	).toMatchObject({
		isHidden: true,
		health: "incompatible",
		incompatibilityReason: "package-identity-conflict",
	});
});

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
				{
					healthReason: null,
					hiddenIntent: false,
					lifecycleIntent: "ready",
					incompatibilityReason: null,
					configuredSecretPaths: [path],
				},
				schema,
				false,
				false,
			),
		).toEqual({
			isHidden: true,
			healthReason: null,
			incompatibilityReason: null,
			health: "needs-configuration",
		});
		expect(
			resolveRestoredIntegrationDisabled(
				{ isDisabled: false, configuredSecretPaths: [path] },
				schema,
			),
		).toBe(true);
	}
});

it("restores integrations with OAuth connection settings disabled", () => {
	const schema = {
		fields: {
			endpoint: { type: "string", label: "Endpoint", description: "Endpoint" },
			account: {
				type: "string",
				label: "Account",
				description: "Linked account",
				format: { provider: "account", kind: "oauth-connection" },
			},
		},
	} satisfies AppSchema;
	expect(
		resolveRestoredIntegrationDisabled(
			{ isDisabled: false, configuredSecretPaths: ["/account"] },
			schema,
		),
	).toBe(true);
	expect(
		resolveRestoredIntegrationDisabled(
			{ isDisabled: false, configuredSecretPaths: [] },
			{ fields: { endpoint: schema.fields.endpoint } },
		),
	).toBe(false);
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
		readonly calendarSourceKey?: string;
	} = {},
): ArchiveRecords => ({
	integrations: [],
	installations: [],
	privatePlugins: [],
	profile: {
		image: null,
		name: "User",
		preferences: { language: null, disableIntegrations: false },
	},
	calendarSourceOverrides:
		input.calendarSourceKey === undefined
			? []
			: [{ isHidden: true, slug: "owner-dates", pluginKey: input.calendarSourceKey }],
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
					isHidden: false,
					slug: "owner-view",
					id: "saved-view-id",
					kind: "builtin-override",
					pluginKey: input.viewKey === undefined ? "owner-key" : input.viewKey,
				}
			: {
					sortOrder: 0,
					icon: "list",
					kind: "custom",
					isHidden: false,
					isBuiltin: false,
					name: "Owner view",
					id: "saved-view-id",
					slug: "archived-user-view",
					dataSources: provenanceQuery,
					createdAt: "2026-08-23T12:00:00.000Z",
					updatedAt: "2026-08-23T12:00:00.000Z",
					renderer: { kind: "kernel", name: "results-table" },
					pluginKey: input.viewKey === undefined ? "owner-key" : input.viewKey,
					settings: {
						pageSize: 50,
						entityLink: null,
						rowKeyFields: ["id"],
						sourceName: "savedView",
						columns: [{ field: "name", label: "Name", displayKind: "text" }],
					},
				},
	],
});

const provenanceEntityDefinition: DefinitionSnapshot["entitySchemas"][string] = {
	icon: "box",
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
	entitySchemas: {
		[definitionKey("entity", definitionOwner("owner-id"), "owner-entity")]:
			provenanceEntityDefinition,
	},
	relationshipSchemas: {
		[definitionKey("relationship", definitionOwner("owner-id"), "owner-link")]: {
			name: "Owner link",
			slug: "owner-link",
			pluginId: "owner-id",
			propertiesSchema: { fields: {} },
			sourceEntitySchemaSlug: "owner-entity",
			targetEntitySchemaSlug: "owner-entity",
		},
	},
	savedViews: {
		[definitionKey("saved-view", definitionOwner("owner-id"), "owner-view")]: {
			icon: "list",
			sortOrder: 0,
			settings: {},
			slug: "owner-view",
			name: "Owner view",
			pluginId: "owner-id",
			dataSources: provenanceQuery,
			renderer: { kind: "kernel", name: "entity-browser" },
		},
	},
	signalSchemas: {
		[definitionKey("signal", definitionOwner("owner-id"), "owner.signal")]: {
			pluginId: "owner-id",
			name: "Owner signal",
			slug: "owner.signal",
			catalogState: "active",
			propertiesSchema: { fields: {} },
			audiencePolicy: { kind: "actor" },
			notificationHookSlug: "owner.notify",
		},
	},
	calendarSources: {
		[definitionKey("calendar-source", definitionOwner("owner-id"), "owner-dates")]: {
			art: null,
			done: null,
			caption: null,
			icon: "calendar",
			precision: "date",
			startAt: "startAt",
			name: "Owner dates",
			slug: "owner-dates",
			pluginId: "owner-id",
			subject: {
				entityAlias: "entity",
				schemas: [
					{ owner: definitionOwner("owner-id"), slug: EntitySchemaSlug.make("owner-entity") },
				],
			},
			query: {
				from: { alias: "entity", table: "entity" },
				output: {
					type: "rows",
					fields: [
						{ key: "startAt", expr: { type: "column", field: "createdAt", tableAlias: "entity" } },
					],
				},
			},
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
			{
				event: provenanceEvent(),
				name: "calendar source with a foreign owner",
				records: provenanceRecords({ calendarSourceKey: "foreign-key" }),
			},
			{
				event: provenanceEvent(),
				name: "calendar source with an unmapped key",
				records: provenanceRecords({ calendarSourceKey: "unmapped-key" }),
			},
		] as const;
		for (const testCase of cases) {
			const error = yield* preflightProvenance(
				testCase.records,
				{ count: 1, sha256: "", read: () => Stream.make(testCase.event) },
				pluginIds,
				"definitions" in testCase ? testCase.definitions : provenanceDefinitions,
				[],
			).pipe(Effect.flip);
			expect(error.message, testCase.name).toMatch(
				/wrong plugin owner|unmapped plugin key|unavailable/,
			);
		}
		yield* preflightProvenance(
			provenanceRecords({ calendarSourceKey: "owner-key" }),
			{ count: 1, sha256: "", read: () => Stream.make(provenanceEvent()) },
			pluginIds,
			provenanceDefinitions,
			[],
		);
	}),
);

it("does not apply archived translations to an existing global entity", () => {
	const translations = [
		{
			language: "en",
			properties: null,
			populatedAt: null,
			name: "Archived overwrite",
			createdAt: "2026-08-23T12:00:00.000Z",
			updatedAt: "2026-08-23T12:00:00.000Z",
		},
	];
	expect(selectTranslationsForRestore(false, translations)).toEqual([]);
	expect(selectTranslationsForRestore(true, translations)).toBe(translations);
});

it.effect("rejects user entities with system-provider provenance during preflight", () =>
	Effect.gen(function* () {
		const source = revisionPackage("shared", "v1", "bottle");
		const packageId = source.manifest.metadata.packageId;
		const key = pluginPackageKey({ packageId, scope: "system" });
		const entity = provenanceRecords().entities[0];
		assert(entity);
		const records: ArchiveRecords = {
			...provenanceRecords(),
			savedViews: [],
			relationships: [],
			entityDependencies: [],
			notificationSubscriptions: [],
			entities: [
				{
					...entity,
					externalId: "external",
					entitySchemaSlug: "bottle",
					entitySchemaPluginKey: key,
					properties: { kind: "one", name: "Private" },
					provider: { pluginKey: key, providerSlug: "shared-provider" },
				},
			],
		};
		const definitions = buildDefinitionSnapshot(
			mergeManifestDefinitions(
				{
					savedViews: [],
					entitySchemas: [],
					signalSchemas: [],
					calendarSources: [],
					relationshipSchemas: [],
				},
				[{ id: "system-owner", manifest: source.manifest }],
			),
		);
		const exit = yield* Effect.exit(
			preflightProvenance(
				records,
				{ count: 0, sha256: "", read: () => Stream.empty },
				new Map([[key, "system-owner"]]),
				definitions,
				[
					{
						packageId,
						version: "v1",
						contentHash: source.contentHash,
						definitionContract: archivePluginDefinitionContract(source.manifest),
					},
				],
			),
		);
		assertExitFails(exit, badRequest("Backup user entity cannot use a system provider"));
	}),
);

it.effect("rejects private-owned global snapshots during preflight", () =>
	Effect.gen(function* () {
		const packageValue = revisionPackage("whiskey", "v1", "bottle");
		const packageId = packageValue.manifest.metadata.packageId;
		const key = pluginPackageKey({ packageId, scope: "user" });
		const dependency = provenanceRecords().entityDependencies[0];
		assert(dependency);
		const records: ArchiveRecords = {
			...provenanceRecords(),
			entities: [],
			savedViews: [],
			relationships: [],
			notificationSubscriptions: [],
			entityDependencies: [
				{ ...dependency, entitySchemaSlug: "bottle", entitySchemaPluginKey: key },
			],
			privatePlugins: [
				{
					key,
					packageId,
					version: "v1",
					compiledScripts: [],
					contentHash: "a".repeat(64),
					manifest: packageValue.manifest,
				},
			],
		};
		const error = yield* preflightProvenance(
			records,
			{ count: 0, sha256: "", read: () => Stream.empty },
			new Map([[key, "private-owner"]]),
			provenanceDefinitions,
			[],
		).pipe(Effect.flip);
		expect(error.message).toContain("private entity cannot request global scope");
	}),
);

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
				page,
			).pipe(Effect.flip);
			expect(settingsError.reason.code).toBe("settings-incompatible");

			const invalidTable = table("missing-table", "missing");
			const sourceError = yield* validateSavedViewDefinition(
				renderer,
				{ label: "valid" },
				document({ invalid: rows(invalidTable, { fields: [] }) }),
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
	).pipe(
		Effect.flip,
		Effect.tap((error) => Effect.sync(() => expect(error.reason.code).toBe("renderer-not-found"))),
	),
);

type RestoreEntityInput = Parameters<BackupRestorePersistence["Service"]["restoreEntity"]>[0];

class FakeRestorePersistence extends Context.Service<
	FakeRestorePersistence,
	{
		readonly eventBatchSizes: Effect.Effect<ReadonlyArray<number>>;
		readonly restoredEntities: Effect.Effect<ReadonlyArray<RestoreEntityInput>>;
	}
>()("test/FakeRestorePersistence") {}

const eventSchema = {
	pluginId: null,
	name: "Review",
	slug: "review",
	propertiesSchema: { fields: {} },
};
const bootstrapEntitySchema = {
	pluginId: null,
	icon: "record",
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

const restoreArchivedEvents = (events: ReadonlyArray<ArchiveEvent>) =>
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
				calendarSourceOverrides: [],
				notificationSubscriptions: [],
				profile: {
					image: null,
					name: "User",
					preferences: { language: null, disableIntegrations: false },
				},
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
				calendarSources: {},
				relationshipSchemas: {},
				entitySchemas: {
					[definitionKey("entity", definitionOwner(null), "bootstrap-entity")]:
						bootstrapEntitySchema,
				},
			},
		);
	});

const restoreWriterLayer = (options: { readonly eventInsertFails?: boolean } = {}) =>
	Layer.effect(BackupRestoreWriter, BackupRestoreWriter.make).pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				fakeDatabaseSession({}),
				Layer.mock(PluginRepository, {
					listPrivateForUser: () => Effect.succeed([]),
					listActiveSystemPlugins: () => Effect.succeed([]),
					listPortablePluginMetadata: () => Effect.succeed([]),
				}),
				Layer.unwrap(
					Effect.gen(function* () {
						const eventBatchSizes = yield* Ref.make<ReadonlyArray<number>>([]);
						const restoredEntities = yield* Ref.make<ReadonlyArray<RestoreEntityInput>>([]);
						return Layer.merge(
							Layer.succeed(FakeRestorePersistence, {
								eventBatchSizes: Ref.get(eventBatchSizes),
								restoredEntities: Ref.get(restoredEntities),
							}),
							Layer.mock(BackupRestorePersistence, {
								restorePortableProfile: () => Effect.succeed(true),
								restoreEntity: (input) =>
									Ref.update(restoredEntities, (all) => [...all, input]).pipe(
										Effect.as(EntityId.make(input.id ?? "restored")),
									),
								restoreEvents: (batch) =>
									options.eventInsertFails
										? Effect.fail(new DbError({ code: "23505", message: "duplicate key value" }))
										: Ref.update(eventBatchSizes, (all) => [...all, batch.length]),
							}),
						);
					}),
				),
				Layer.mock(EntitiesRepository, { listUserEntitiesForBackup: () => Effect.succeed([]) }),
				Layer.mock(SavedViewsRepository, {}),
				Layer.mock(AutomationsRepository, {}),
				Layer.mock(PluginInstallationRepository, {}),
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

layer(restoreWriterLayer())((test) => {
	test.effect("restores an archived entity without origin metadata", () =>
		Effect.gen(function* () {
			yield* restoreArchivedEvents([]);
			const [restored] = yield* (yield* FakeRestorePersistence).restoredEntities;
			expect(restored?.id).not.toBe("archived-bootstrap");
			expect(restored).not.toHaveProperty("origin");
		}),
	);
});

layer(restoreWriterLayer())((test) => {
	test.effect("restores archived events in bounded batches", () =>
		Effect.gen(function* () {
			const events = Array.from({ length: RESTORE_EVENT_BATCH_SIZE + 3 }, (_, index) =>
				archivedEvent(`event-${index.toString().padStart(5, "0")}`),
			);
			yield* restoreArchivedEvents(events);
			expect(yield* (yield* FakeRestorePersistence).eventBatchSizes).toEqual([
				RESTORE_EVENT_BATCH_SIZE,
				3,
			]);
		}),
	);
});

layer(restoreWriterLayer({ eventInsertFails: true }))((test) => {
	test.effect("reports a duplicate archived event id through the primary key insert", () =>
		Effect.gen(function* () {
			const error = yield* restoreArchivedEvents([archivedEvent("event-1")]).pipe(Effect.flip);
			expect(error).toMatchObject({
				path: "events.ndjson",
				_tag: "BackupArchiveError",
				reason: "duplicate_record_id",
			});
		}),
	);
});

describe("account backup restore in PostgreSQL", () => {
	const archivedTimestamp = new Date("2026-09-16T00:00:00.000Z");

	layer(
		BackupRestorePersistence.layer.pipe(
			Layer.provide(SavedViewsRepository.layer),
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)((test) => {
		test.effect("rolls back historical profile and saved-view writes together", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const persistence = yield* BackupRestorePersistence;
				const userId = UserId.make("recipient");
				yield* session
					.transaction(
						Effect.gen(function* () {
							expect(
								yield* persistence.restorePortableProfile(userId, {
									image: null,
									name: "Archived",
									preferences: { language: null, disableIntegrations: false },
								}),
							).toBe(true);
							expect(
								yield* persistence.restoreCustomView({
									userId,
									icon: "view",
									settings: {},
									sortOrder: 0,
									isHidden: false,
									dataSources: null,
									id: "archived-view",
									slug: "archived-view",
									name: "Archived view",
									createdAt: archivedTimestamp,
									updatedAt: archivedTimestamp,
									renderer: { kind: "kernel", name: "entity-browser" },
								}),
							).toBeTruthy();
							return yield* new DbError({ message: "Abort restore" });
						}),
					)
					.pipe(Effect.flip);
				const [profile] = yield* session.run((db) =>
					db.select({ name: tables.user.name }).from(tables.user).where(eq(tables.user.id, userId)),
				);
				expect(profile?.name).toBe("Recipient");
				const views = yield* session.run((db) =>
					db.select().from(tables.savedView).where(eq(tables.savedView.id, "archived-view")),
				);
				expect(views).toEqual([]);
			}),
		);
	});

	const restoreDependencies = Layer.mergeAll(
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
	layer(
		Layer.merge(BackupRestoreWriter.layer, BackupRestorePersistence.layer).pipe(
			Layer.provideMerge(restoreDependencies),
			Layer.provideMerge(revisionDatabaseLayer),
		),
	)((test) => {
		test.effect(
			"restores redacted required private config and historical records without automation history",
			() =>
				Effect.gen(function* () {
					const session = yield* DatabaseSession;
					const plugins = yield* PluginRepository;
					const installations = yield* PluginInstallationRepository;
					yield* session.run((db) =>
						db.execute(
							sql`alter table plugin_installation add column if not exists user_settings jsonb not null default '{}'::jsonb`,
						),
					);
					const basePackage = revisionPackage("portable", "v1", "portable-entity");
					const primarySignal = basePackage.manifest.signalSchemas[0];
					assert(primarySignal);
					const manifest: PluginManifest = {
						...basePackage.manifest,
						signalSchemas: [
							primarySignal,
							{ ...primarySignal, name: "Other signal", slug: "portable.other-signal" },
						],
						userSettingsSchema: {
							unknownKeys: "strict",
							fields: {
								preference: {
									type: "boolean",
									label: "Preference",
									description: "Portable plugin preference",
								},
							},
						},
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
						contentHash: pluginContentHash(
							manifest,
							basePackage.scripts.map(({ entry, compiledCode, compiledFormat }) => ({
								entry,
								format: compiledFormat,
								javascript: compiledCode,
							})),
							basePackage.compiledClient,
						),
					};
					const installedPluginId = yield* session.transaction(
						plugins.persist(packageValue, { scope: "user", ownerId: "recipient" }),
					);
					const pluginKey = pluginPackageKey({
						scope: "user",
						packageId: packageValue.manifest.metadata.packageId,
					});
					const snapshot = buildDefinitionSnapshot(
						mergeManifestDefinitions(
							{
								savedViews: [],
								signalSchemas: [],
								entitySchemas: [],
								calendarSources: [],
								relationshipSchemas: [],
							},
							[{ id: installedPluginId, manifest: packageValue.manifest }],
						),
					);
					const timestamp = "2026-09-16T00:00:00.000Z";
					const records: ArchiveRecords = {
						savedViews: [],
						integrations: [],
						privatePlugins: [],
						entityDependencies: [],
						calendarSourceOverrides: [],
						profile: {
							image: null,
							name: "Restored",
							preferences: { language: null, disableIntegrations: false },
						},
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
								healthReason: null,
								hiddenIntent: false,
								isInitialized: true,
								homeSavedView: null,
								createdAt: timestamp,
								updatedAt: timestamp,
								packageKey: pluginKey,
								lifecycleIntent: "ready",
								config: { unit: "metric" },
								incompatibilityReason: null,
								configuredSecretPaths: ["/token"],
								userSettings: { preference: true },
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
					yield* session.transaction(
						writer.restoreRecords(
							UserId.make("recipient"),
							records,
							new Map(),
							archivedEvents,
							new Map([[pluginKey, installedPluginId]]),
							snapshot,
						),
					);
					const restoredInstallation = yield* installations.findByUserAndPlugin(
						UserId.make("recipient"),
						installedPluginId,
					);
					assert(restoredInstallation?.activeConfigRevisionId);
					const activeConfigRevisionId = restoredInstallation.activeConfigRevisionId;
					expect(restoredInstallation).toMatchObject({
						isHidden: true,
						isInitialized: true,
						health: "needs-configuration",
					});
					expect(restoredInstallation.config).toEqual({ unit: "metric" });
					const [restoredUserSettings] = yield* session.run((db) =>
						db
							.select({ userSettings: tables.pluginInstallation.userSettings })
							.from(tables.pluginInstallation)
							.where(eq(tables.pluginInstallation.id, restoredInstallation.id)),
					);
					expect(restoredUserSettings?.userSettings).toEqual({ preference: true });
					const [configRevision] = yield* session.run((db) =>
						db
							.select()
							.from(tables.pluginConfigRevision)
							.where(eq(tables.pluginConfigRevision.id, activeConfigRevisionId)),
					);
					const [encryptionKey] = yield* session.run((db) =>
						db.select().from(tables.pluginConfigEncryptionKey),
					);
					assert(configRevision?.encryptedPayload);
					assert(encryptionKey);
					expect(configRevision.encryptionKeyId).toBe(encryptionKey.id);
					expect(new TextDecoder().decode(configRevision.encryptedPayload)).not.toContain("metric");
					expect(records.installations[0]?.config).not.toHaveProperty("token");
					expect(records.installations[0]).not.toHaveProperty("activeConfigRevisionId");
					expect(
						yield* session.run((db) => db.select().from(tables.pluginConfigRevision)),
					).toHaveLength(1);
					const subscriptions = yield* session.run((db) =>
						db
							.select()
							.from(tables.notificationSubscription)
							.where(eq(tables.notificationSubscription.userId, "recipient")),
					);
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
						const [row] = yield* session.run((db) => db.select({ count: count() }).from(tableName));
						expect(row?.count).toBe(0);
					}
				}),
		);
		test.effect("does not overwrite a shared system entity from a user backup snapshot", () =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const plugins = yield* PluginRepository;
				const writer = yield* BackupRestoreWriter;
				const entities = yield* EntitiesRepository;
				const persistence = yield* BackupRestorePersistence;
				const base = revisionPackage("shared", "v1", "bottle");
				const normalized = normalizePluginPackage(
					yield* normalizePluginSource({
						manifest: base.manifest,
						compiledScripts: base.scripts.map(({ entry, compiledCode, compiledFormat }) => ({
							entry,
							format: compiledFormat,
							javascript: compiledCode,
						})),
					}),
				);
				const packageId = normalized.manifest.metadata.packageId;
				const id = yield* session.transaction(
					plugins.persist(normalized, { ownerId: null, scope: "system" }),
				);
				const provider = yield* plugins.resolveProviderBySlugs({
					pluginId: id,
					providerSlug: "shared-provider",
				});
				assert(provider);
				const globalId = yield* session.transaction(
					persistence.restoreEntity({
						userId: null,
						name: "Shared",
						id: crypto.randomUUID(),
						providerId: provider.id,
						entitySchemaPluginId: id,
						entitySchemaSlug: "bottle",
						createdAt: archivedTimestamp,
						updatedAt: archivedTimestamp,
						externalId: "shared-external",
						properties: { kind: "one", name: "Shared" },
					}),
				);
				const before = yield* entities.listGlobalEntitiesByIdsForBackup([globalId]);
				const key = pluginPackageKey({ packageId, scope: "system" });
				const records: ArchiveRecords = {
					...provenanceRecords(),
					entities: [],
					savedViews: [],
					relationships: [],
					notificationSubscriptions: [],
					entityDependencies: [
						{
							translations: [],
							populatedAt: null,
							id: "archived-shared",
							entitySchemaSlug: "bottle",
							entitySchemaPluginKey: key,
							name: "Untrusted overwrite",
							externalId: "shared-external",
							createdAt: archivedTimestamp.toISOString(),
							updatedAt: archivedTimestamp.toISOString(),
							properties: { kind: "one", name: "Untrusted overwrite" },
							provider: { pluginKey: key, providerSlug: "shared-provider" },
							identity: { pluginKey: key, kind: "provider", providerSlug: "shared-provider" },
						},
					],
				};
				const definitions = buildDefinitionSnapshot(
					mergeManifestDefinitions(
						{
							savedViews: [],
							entitySchemas: [],
							signalSchemas: [],
							calendarSources: [],
							relationshipSchemas: [],
						},
						[{ id, manifest: normalized.manifest }],
					),
				);
				const required = [
					{
						packageId,
						version: "v1",
						slug: "shared",
						contentHash: normalized.contentHash,
						definitionContract: archivePluginDefinitionContract(normalized.manifest),
					},
				];
				const mapped = yield* writer.assertRequiredPlugins(required);
				const events = { count: 0, sha256: "", read: () => Stream.empty };
				yield* writer.preflight(records, events, mapped, definitions, required);
				yield* session.transaction(
					writer.restoreRecords(
						UserId.make("recipient"),
						records,
						new Map(),
						events,
						mapped,
						definitions,
					),
				);
				expect(yield* entities.listGlobalEntitiesByIdsForBackup([globalId])).toEqual(before);
			}),
		);
	});
	for (const mode of [
		"retained-quarantine",
		"partial-quarantine",
		"destination-conflict",
	] as const) {
		layer(
			Layer.mergeAll(
				BackupRestorePersistence.layer,
				BackupRestoreWriter.layer,
				PluginBackupRestore.layer,
				BackupExportSnapshot.layer,
			).pipe(
				Layer.provideMerge(restoreDependencies),
				Layer.provideMerge(revisionDatabaseLayer),
				Layer.provideMerge(BunFileSystem.layer),
				Layer.provide(
					Layer.mock(ManagedAssetsService, {
						verifyManagedAssetOwnership: () => Effect.succeed([]),
					}),
				),
			),
		)((test) => {
			test.effect(
				`round-trips equal-name private packages with ${mode} through production archives`,
				() =>
					Effect.gen(function* () {
						const session = yield* DatabaseSession;
						const plugins = yield* PluginRepository;
						const persistence = yield* BackupRestorePersistence;
						const installations = yield* PluginInstallationRepository;
						const automations = yield* AutomationsRepository;
						const sourceUser = UserId.make("owner");
						const destinationUser = UserId.make("recipient");
						const sources: Array<{
							readonly packageValue: NormalizedPlugin;
							readonly sourceId: string;
							readonly entityId: EntityId;
						}> = [];
						for (const label of ["A", "B"]) {
							const base = revisionPackage("whiskey", "v1", "bottle");
							const authoredEntity = table("entity", "owned");
							const authoredQuery = document({
								records: rows(authoredEntity, {
									fields: [
										field("id", column(authoredEntity, "id")),
										field("owner", pluginId({ kind: "self" })),
									],
								}),
							});
							const manifest: PluginManifest = {
								...base.manifest,
								metadata: { ...base.manifest.metadata, name: "Whiskey" },
								integrationProviders: [
									{
										lot: "push",
										slug: "import",
										name: "Import",
										description: "Owned integration",
										settingsSchema: {
											fields: {
												note: { label: "Note", type: "string", description: "Opaque note" },
											},
										},
									},
								],
								savedViews: [
									{
										icon: "box",
										sortOrder: 0,
										slug: "all-bottles",
										name: "All bottles",
										dataSources: authoredQuery,
										renderer: { kind: "kernel", name: "results-table" },
										settings: {
											pageSize: 50,
											entityLink: null,
											rowKeyFields: ["id"],
											sourceName: "records",
											columns: [{ label: "Owner", field: "owner", displayKind: "text" }],
										},
									},
								],
								calendarSources: [
									{
										icon: "calendar",
										startAt: "startAt",
										name: "Bottle dates",
										slug: "bottle-dates",
										precision: "instant",
										subject: {
											entityAlias: "owned",
											schemas: [{ owner: { kind: "self" }, slug: EntitySchemaSlug.make("bottle") }],
										},
										query: {
											from: authoredEntity,
											output: {
												type: "rows",
												fields: [field("startAt", column(authoredEntity, "createdAt"))],
											},
										},
									},
								],
							};
							const source = yield* normalizePluginSource({
								manifest,
								compiledScripts: base.scripts.map(({ entry, compiledCode, compiledFormat }) => ({
									entry,
									format: compiledFormat,
									javascript: compiledCode,
								})),
							});
							const packageValue = normalizePluginPackage(source);
							const sourceId = yield* session.transaction(
								plugins
									.lockIngestion()
									.pipe(
										Effect.andThen(
											plugins.persist(packageValue, { scope: "user", ownerId: sourceUser }),
										),
									),
							);
							const entityId = EntityId.make(crypto.randomUUID());
							const entityTable = table("entity", "bottles");
							const dataSources = document({
								records: rows(entityTable, {
									fields: [
										field("id", column(entityTable, "id")),
										field("owner", pluginId({ kind: "local", pluginId: PluginId.make(sourceId) })),
										field("literal", literal(sourceId)),
									],
								}),
							});
							yield* session.transaction(
								Effect.gen(function* () {
									const installation = yield* persistence.restoreInstallation({
										config: {},
										isHidden: true,
										userSettings: {},
										pluginId: sourceId,
										userId: sourceUser,
										createdAt: fixedDate,
										updatedAt: fixedDate,
										health: "installing",
										preserveExistingConfig: false,
										sortOrder: label === "A" ? 1 : 2,
										isInitialized: label !== "A" || mode !== "partial-quarantine",
									});
									assert(installation);
									yield* persistence.activateRestored({
										id: installation.id,
										updatedAt: fixedDate,
										isHidden: label === "B",
										healthReason: label === "A" ? "Retained private claim" : null,
										health:
											mode !== "destination-conflict" && label === "A" ? "incompatible" : "ready",
										incompatibilityReason:
											mode !== "destination-conflict" && label === "A"
												? "package-identity-conflict"
												: null,
									});
									const provider = yield* plugins.resolveProviderBySlugs({
										pluginId: sourceId,
										providerSlug: "whiskey-provider",
									});
									assert(provider);
									yield* persistence.restoreEntity({
										name: label,
										id: entityId,
										externalId: label,
										userId: sourceUser,
										createdAt: fixedDate,
										updatedAt: fixedDate,
										providerId: provider.id,
										entitySchemaSlug: "bottle",
										entitySchemaPluginId: sourceId,
										properties: { name: label, kind: "one" },
									});
									yield* persistence.restoreRelationship({
										properties: {},
										userId: sourceUser,
										createdAt: fixedDate,
										id: crypto.randomUUID(),
										sourceEntityId: entityId,
										targetEntityId: entityId,
										relationshipSchemaPluginId: sourceId,
										relationshipSchemaSlug: "whiskey-link",
									});
									yield* persistence.restoreEvents([
										{
											entityId,
											userId: sourceUser,
											createdAt: fixedDate,
											updatedAt: fixedDate,
											occurredAt: fixedDate,
											id: crypto.randomUUID(),
											sessionEntityId: entityId,
											eventSchemaSlug: "changed",
											properties: { value: label },
											eventSchemaPluginId: sourceId,
										},
									]);
									yield* automations.insertNotificationSubscription({
										metadata: null,
										isActive: false,
										userId: sourceUser,
										signalSchemaPluginId: sourceId,
										signalSchemaSlug: SignalSchemaSlug.make("whiskey.signal"),
									});
									yield* persistence.restoreBuiltinOverride({
										userId: sourceUser,
										pluginId: sourceId,
										slug: "all-bottles",
										isHidden: label === "A",
										sortOrder: label === "A" ? 4 : 8,
									});
									if (label === "A") {
										yield* persistence.restoreCalendarSourceOverride({
											isHidden: true,
											userId: sourceUser,
											pluginId: sourceId,
											slug: "bottle-dates",
										});
									}
									for (const suffix of ["", "-extra", "-unassociated"]) {
										const pluginInstallationId =
											suffix === "-unassociated" ? null : installation.id;
										yield* persistence.restoreForUser({
											name: label,
											isDisabled: false,
											userId: sourceUser,
											pluginInstallationId,
											createdAt: fixedDate,
											updatedAt: fixedDate,
											syncOwnership: false,
											minimumProgress: "0",
											lastFinishedAt: null,
											maximumProgress: "100",
											id: crypto.randomUUID(),
											extraSettings: { disableOnContinuousErrors: false },
											lot: pluginInstallationId === null ? "sink" : "push",
											provider: pluginInstallationId === null ? dataJsonSource : "import",
											providerSpecifics: pluginInstallationId === null ? {} : { note: sourceId },
										});
										const view = yield* persistence.restoreCustomView({
											name: label,
											icon: "box",
											dataSources,
											sortOrder: 0,
											isHidden: false,
											userId: sourceUser,
											pluginInstallationId,
											createdAt: fixedDate,
											updatedAt: fixedDate,
											id: crypto.randomUUID(),
											slug: `bottles-${label.toLowerCase()}${suffix}`,
											renderer: { kind: "kernel", name: "results-table" },
											settings: {
												pageSize: 50,
												entityLink: null,
												rowKeyFields: ["id"],
												sourceName: "records",
												columns: [{ label: "Owner", field: "owner", displayKind: "text" }],
											},
										});
										assert(view);
										if (suffix === "") {
											yield* installations.setHomeSavedView(sourceUser, installation.id, {
												kind: "custom",
												savedViewId: SavedViewId.make(view.id),
											});
										}
									}
								}),
							);
							sources.push({ sourceId, entityId, packageValue });
						}
						const fs = yield* FileSystem.FileSystem;
						const directory = yield* fs.makeTempDirectoryScoped();
						const exported = yield* session.transaction(
							(yield* BackupExportSnapshot).prepareExportSnapshot(
								sourceUser,
								`${directory}/events.ndjson`,
							),
						);
						expect(exported.records.privatePlugins).toHaveLength(2);
						expect(
							exported.records.installations.find(({ sortOrder }) => sortOrder === 1)
								?.isInitialized,
						).toBe(mode !== "partial-quarantine");
						expect(new Set(exported.records.privatePlugins.map(({ key }) => key)).size).toBe(2);
						const firstSource = sources[0];
						assert(firstSource);
						const firstKey = pluginPackageKey({
							scope: "user",
							packageId: firstSource.packageValue.manifest.metadata.packageId,
						});
						expect(exported.records.calendarSourceOverrides).toEqual([
							{ isHidden: true, pluginKey: firstKey, slug: "bottle-dates" },
						]);
						const validated = yield* validateArchiveStream(
							createArchiveStream({
								assets: [],
								appVersion: "test",
								records: exported.records,
								archiveId: "private-round-trip",
								redactions: exported.redactions,
								createdAt: "2026-10-01T00:00:00.000Z",
								requiredPlugins: exported.requiredPlugins,
								events: {
									...exported.events,
									chunks: Stream.toAsyncIterable(fs.stream(exported.events.path)),
								},
							}),
							{ directory },
						);
						const first = sources[0];
						assert(first);
						let systemId: string | null = null;
						if (mode === "destination-conflict") {
							systemId = yield* session.transaction(
								plugins
									.lockIngestion()
									.pipe(
										Effect.andThen(
											plugins.persist(first.packageValue, { ownerId: null, scope: "system" }),
										),
									),
							);
						}
						const systemBefore =
							systemId === null ? null : yield* plugins.findActiveSystemPluginById(systemId);
						const pluginRestore = yield* PluginBackupRestore;
						const writer = yield* BackupRestoreWriter;
						const prepared = yield* pluginRestore.prepare(validated.records.privatePlugins);
						const ids = yield* session.transaction(
							Effect.gen(function* () {
								const persistedIds = yield* pluginRestore.persist(destinationUser, prepared);
								const definitions = yield* pluginRestore.buildDefinitions(prepared, persistedIds);
								yield* writer.preflight(
									validated.records,
									validated.events,
									persistedIds,
									definitions,
									[],
								);
								yield* writer.restoreRecords(
									destinationUser,
									validated.records,
									new Map(),
									validated.events,
									persistedIds,
									definitions,
								);
								return persistedIds;
							}),
						);
						for (const [index, source] of sources.entries()) {
							const key = pluginPackageKey({
								scope: "user",
								packageId: source.packageValue.manifest.metadata.packageId,
							});
							const targetId = ids.get(key);
							assert(targetId);
							expect(targetId).not.toBe(source.sourceId);
							const installation = yield* installations.findByUserAndPlugin(
								destinationUser,
								targetId,
							);
							expect(installation).toMatchObject({
								isHidden: index === 1,
								health: index === 0 ? "incompatible" : "ready",
								isInitialized: index !== 0 || mode !== "partial-quarantine",
								incompatibilityReason: index === 0 ? "package-identity-conflict" : null,
							});
						}
						const restoredCalendarOverrides = yield* session.run((db) =>
							db
								.select({
									slug: tables.calendarSourceOverride.slug,
									isHidden: tables.calendarSourceOverride.isHidden,
									pluginId: tables.calendarSourceOverride.pluginId,
								})
								.from(tables.calendarSourceOverride)
								.where(eq(tables.calendarSourceOverride.userId, destinationUser)),
						);
						expect(restoredCalendarOverrides).toEqual([
							{ isHidden: true, slug: "bottle-dates", pluginId: ids.get(firstKey) },
						]);
						expect(restoredCalendarOverrides[0]?.pluginId).not.toBe(firstSource.sourceId);
						const restoredEntities = yield* (yield* EntitiesRepository).listUserEntitiesForBackup(
							destinationUser,
						);
						expect(restoredEntities).toHaveLength(2);
						for (const row of restoredEntities) {
							expect([...ids.values()]).toContain(row.entitySchemaPluginId);
							expect(row.provider?.pluginId).toBe(row.entitySchemaPluginId);
							expect(sources.map(({ entityId }) => entityId)).not.toContain(row.id);
						}
						const restoredViews = yield* (yield* SavedViewsRepository).listForBackup(
							destinationUser,
						);
						expect(restoredViews.filter((view) => !view.isBuiltin)).toHaveLength(6);
						for (const view of restoredViews) {
							if (!view.isBuiltin) {
								const index = view.name === "A" ? 0 : 1;
								const source = sources[index];
								assert(source);
								const destinationId = ids.get(
									pluginPackageKey({
										scope: "user",
										packageId: source.packageValue.manifest.metadata.packageId,
									}),
								);
								expect(view.dataSources?.queries["records"]?.output).toMatchObject({
									fields: [
										{},
										{ expr: { reference: { kind: "local", pluginId: destinationId } } },
										{ expr: { value: source.sourceId } },
									],
								});
								const installation = yield* installations.findByUserAndPlugin(
									destinationUser,
									destinationId ?? "",
								);
								expect(view.pluginInstallationId).toBe(
									view.slug.endsWith("-unassociated") ? null : installation?.id,
								);
								if (!view.slug.endsWith("-extra") && !view.slug.endsWith("-unassociated")) {
									expect(installation?.homeSavedView).toEqual({
										kind: "custom",
										savedViewId: view.id,
									});
								}
							}
						}
						const reexported = yield* session.transaction(
							(yield* BackupExportSnapshot).prepareExportSnapshot(
								destinationUser,
								`${directory}/restored-events.ndjson`,
							),
						);
						expect(reexported.records.privatePlugins).toHaveLength(2);
						expect(manifestsByKey(exported.records.privatePlugins)).toEqual(
							Object.fromEntries(
								sources.map(({ packageValue }) => [
									pluginPackageKey({
										scope: "user",
										packageId: packageValue.manifest.metadata.packageId,
									}),
									stableStringify(packageValue.manifest),
								]),
							),
						);
						expect(manifestsByKey(reexported.records.privatePlugins)).toEqual(
							manifestsByKey(exported.records.privatePlugins),
						);
						expect(
							reexported.records.savedViews.filter((view) => view.kind === "builtin-override"),
						).toHaveLength(2);
						for (const view of reexported.records.savedViews) {
							if (view.kind === "builtin-override") {
								const source = sources[view.sortOrder === 4 ? 0 : 1];
								assert(source);
								const targetId = ids.get(
									pluginPackageKey({
										scope: "user",
										packageId: source.packageValue.manifest.metadata.packageId,
									}),
								);
								const definitions = yield* pluginRestore.buildDefinitions(prepared, ids);
								const definition =
									definitions.savedViews[
										definitionKey("saved-view", definitionOwner(targetId ?? null), "all-bottles")
									];
								expect(definition?.dataSources?.queries["records"]?.output).toMatchObject({
									fields: [{}, { expr: { reference: { kind: "local", pluginId: targetId } } }],
								});
								expect(view.pluginKey).toBe(
									pluginPackageKey({
										scope: "user",
										packageId: source.packageValue.manifest.metadata.packageId,
									}),
								);
							}
						}
						expect(reexported.records.calendarSourceOverrides).toEqual(
							exported.records.calendarSourceOverrides,
						);
						expect(reexported.records.integrations).toHaveLength(6);
						for (const integration of reexported.records.integrations) {
							if (integration.packageKey === null) {
								expect(integration.provider).toBe(dataJsonSource);
								expect(integration.providerSpecifics).toEqual({});
								continue;
							}
							const source = sources[integration.name === "A" ? 0 : 1];
							assert(source);
							expect(integration.providerSpecifics).toEqual({ note: source.sourceId });
							expect(integration.packageKey).toBe(
								pluginPackageKey({
									scope: "user",
									packageId: source.packageValue.manifest.metadata.packageId,
								}),
							);
						}
						expect(reexported.records.notificationSubscriptions).toHaveLength(2);
						expect(
							new Set(
								reexported.records.notificationSubscriptions.map(
									({ signalSchemaPluginKey }) => signalSchemaPluginKey,
								),
							).size,
						).toBe(2);
						expect(reexported.records.relationships).toHaveLength(2);
						for (const relationship of reexported.records.relationships) {
							const entity = reexported.records.entities.find(
								({ id }) => id === relationship.sourceEntityId,
							);
							expect(entity?.entitySchemaPluginKey).toBe(relationship.relationshipSchemaPluginKey);
							expect(relationship.targetEntityId).toBe(relationship.sourceEntityId);
						}
						const eventLines = (yield* fs.readFileString(reexported.events.path))
							.trim()
							.split("\n");
						expect(eventLines).toHaveLength(2);
						for (const line of eventLines) {
							const event = yield* Schema.decodeEffect(Schema.fromJsonString(ArchiveEvent))(line);
							const entity = reexported.records.entities.find(({ id }) => id === event.entityId);
							expect(entity?.entitySchemaPluginKey).toBe(event.eventSchemaPluginKey);
							expect(event.sessionEntityId).toBe(event.entityId);
						}
						expect(
							reexported.records.installations.find(
								({ lifecycleIntent }) => lifecycleIntent === "incompatible",
							),
						).toMatchObject({
							hiddenIntent: false,
							isInitialized: mode !== "partial-quarantine",
							incompatibilityReason: "package-identity-conflict",
						});
						if (systemId !== null) {
							expect(yield* plugins.findActiveSystemPluginById(systemId)).toEqual(systemBefore);
						}
					}).pipe(Effect.scoped),
			);
		});
	}
});

const archivedAsset = { type: "s3" as const, key: "archived/asset.png" };
const restoredAsset = { type: "s3" as const, key: "permanent/restored-asset.png" };
const assetPluginId = "asset-system-plugin";
const assetPluginKey = "asset-system-key";
const assetSchemaSlug = "asset-dependency";
const assetPropertiesSchema: AppSchema = {
	fields: {
		image: managedAssetProperty,
		title: { type: "string", label: "Title", description: "Title" },
	},
};
const assetPageManifest = fixtureManifest();
const assetSystemPlugin: StoredPlugin = {
	scripts: [],
	ownerId: null,
	scope: "system",
	status: "active",
	id: assetPluginId,
	contentHash: "asset-hash",
	activationId: "asset-activation",
	packageId: assetPageManifest.metadata.packageId,
	manifest: {
		...assetPageManifest,
		client: {
			apiVersion: 1,
			homeView: null,
			exports: {
				summary: {
					kind: "page",
					entry: "client/summary.tsx",
					automaticEntityPresentations: false,
					settingsSchema: { unknownKeys: "strict", fields: { image: managedAssetProperty } },
				},
			},
		},
	},
};
const assetDefinitions: DefinitionSnapshot = {
	savedViews: {},
	signalSchemas: {},
	calendarSources: {},
	relationshipSchemas: {},
	entitySchemas: {
		[definitionKey("entity", definitionOwner(assetPluginId), assetSchemaSlug)]: {
			icon: "box",
			eventSchemas: {},
			slug: assetSchemaSlug,
			pluginId: assetPluginId,
			name: "Asset dependency",
			mergeIdentityProperties: [],
			propertiesSchema: assetPropertiesSchema,
		},
	},
};
const assetRestoreLayer = (assetOwnerUserId: string) =>
	Layer.effect(BackupRestoreWriter, BackupRestoreWriter.make).pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				fakeDatabaseSession({
					select: () => ({
						from: () => ({
							where: () => ({
								orderBy: () => ({
									for: () =>
										Effect.succeed([
											{
												retiredAt: null,
												key: restoredAsset.key,
												provider: restoredAsset.type,
												ownerUserId: assetOwnerUserId,
											},
										]),
								}),
							}),
						}),
					}),
				}),
				Layer.mock(PluginRepository, {
					listPrivateForUser: () => Effect.succeed([]),
					listActiveSystemPlugins: () => Effect.succeed([assetSystemPlugin]),
				}),
				Layer.mock(BackupRestorePersistence, {
					restoreEvents: () => Effect.void,
					restorePortableProfile: () => Effect.succeed(true),
					restoreEntity: (input) => Effect.succeed(EntityId.make(input.id ?? "restored")),
					restoreCustomView: () => Effect.die("A rejected saved view must not be restored"),
					restoreTranslation: () => Effect.die("A rejected translation must not be restored"),
				}),
				Layer.mock(EntitiesRepository, {
					listUserEntitiesForBackup: () => Effect.succeed([]),
					findGlobalEntityForRestore: () => Effect.succeed(null),
				}),
				Layer.mock(SavedViewsRepository, {}),
				Layer.mock(AutomationsRepository, {}),
				Layer.mock(PluginInstallationRepository, {}),
			),
		),
	);
const assetRecords = (overrides: Partial<ArchiveRecords>): ArchiveRecords => ({
	entities: [],
	savedViews: [],
	integrations: [],
	installations: [],
	relationships: [],
	privatePlugins: [],
	entityDependencies: [],
	calendarSourceOverrides: [],
	notificationSubscriptions: [],
	profile: {
		image: null,
		name: "User",
		preferences: { language: null, disableIntegrations: false },
	},
	...overrides,
});
const assetDependency = (
	properties: ArchiveRecords["entityDependencies"][number]["properties"],
	translations: ArchiveRecords["entityDependencies"][number]["translations"] = [],
): ArchiveRecords["entityDependencies"][number] => ({
	properties,
	translations,
	provider: null,
	populatedAt: null,
	name: "Dependency",
	id: "asset-dependency",
	externalId: "asset-external",
	entitySchemaSlug: assetSchemaSlug,
	entitySchemaPluginKey: assetPluginKey,
	createdAt: "2026-08-23T12:00:00.000Z",
	updatedAt: "2026-08-23T12:00:00.000Z",
	identity: {
		kind: "bootstrap",
		pluginKey: assetPluginKey,
		externalId: "asset-external",
		entitySchemaSlug: assetSchemaSlug,
	},
});
const restoreAssetRecords = (records: ArchiveRecords) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const writer = yield* BackupRestoreWriter;
		return yield* session
			.transaction(
				writer.restoreRecords(
					UserId.make("user-id"),
					records,
					new Map([[`${archivedAsset.type}:${archivedAsset.key}`, restoredAsset]]),
					{ count: 0, sha256: "", read: () => Stream.empty },
					new Map([[assetPluginKey, assetPluginId]]),
					assetDefinitions,
				),
			)
			.pipe(Effect.exit);
	});
const assetForbidden = new BackupBadRequest({ reason: { code: "asset-forbidden" } });

layer(assetRestoreLayer("user-id"))((test) => {
	test.effect("rejects a restored global dependency that carries a managed asset", () =>
		Effect.gen(function* () {
			assertExitFails(
				yield* restoreAssetRecords(
					assetRecords({
						entityDependencies: [assetDependency({ title: "Shared", image: archivedAsset })],
					}),
				),
				assetForbidden,
			);
		}),
	);

	test.effect("rejects a restored global-dependency translation that carries a managed asset", () =>
		Effect.gen(function* () {
			assertExitFails(
				yield* restoreAssetRecords(
					assetRecords({
						entityDependencies: [
							assetDependency({ title: "Shared" }, [
								{
									language: "es",
									populatedAt: null,
									name: "Compartido",
									properties: { image: archivedAsset },
									createdAt: "2026-08-23T12:00:00.000Z",
									updatedAt: "2026-08-23T12:00:00.000Z",
								},
							]),
						],
					}),
				),
				assetForbidden,
			);
		}),
	);
});

layer(assetRestoreLayer("user-id"))((test) => {
	test.effect("rejects a restored custom view rendered by the kernel calendar", () =>
		Effect.gen(function* () {
			assertExitFails(
				yield* restoreAssetRecords(
					assetRecords({
						savedViews: [
							{
								sortOrder: 0,
								settings: {},
								kind: "custom",
								isHidden: false,
								pluginKey: null,
								icon: "calendar",
								isBuiltin: false,
								dataSources: null,
								id: "calendar-copy",
								name: "Calendar copy",
								slug: "calendar-copy",
								createdAt: "2026-08-23T12:00:00.000Z",
								updatedAt: "2026-08-23T12:00:00.000Z",
								renderer: { kind: "kernel", name: "calendar" },
							},
						],
					}),
				),
				badRequest("Backup saved view definition is invalid"),
			);
		}),
	);
});

layer(assetRestoreLayer("foreign-owner"))((test) => {
	test.effect("rejects a restored saved view whose settings reference a foreign asset", () =>
		Effect.gen(function* () {
			assertExitFails(
				yield* restoreAssetRecords(
					assetRecords({
						savedViews: [
							{
								icon: "box",
								sortOrder: 0,
								kind: "custom",
								isHidden: false,
								pluginKey: null,
								isBuiltin: false,
								id: "asset-view",
								dataSources: null,
								slug: "asset-view",
								name: "Asset view",
								settings: { image: restoredAsset },
								createdAt: "2026-08-23T12:00:00.000Z",
								updatedAt: "2026-08-23T12:00:00.000Z",
								renderer: { kind: "plugin", exportName: "summary", pluginKey: assetPluginKey },
							},
						],
					}),
				),
				assetForbidden,
			);
		}),
	);
});
