import { ClientRendererDefinition } from "@ryot-app/contract/modules/client-pages/schemas";
import { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { jsonValueSchema, type JsonValue } from "@ryot-app/contract/modules/sandbox/wire";
import { KernelSavedViewRendererName } from "@ryot-app/contract/modules/saved-views/schemas";
import { CanonicalBase64 } from "@ryot-app/contract/schema/base64";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { Result, Schema } from "effect";

const nonNegativeInteger = Schema.Finite.pipe(
	Schema.check(Schema.isInt()),
	Schema.check(Schema.isGreaterThanOrEqualTo(0)),
);
const sha256 = Schema.String.pipe(
	Schema.check(Schema.makeFilter((value) => /^[a-f0-9]{64}$/.test(value))),
);
const isoTimestamp = Schema.String.pipe(
	Schema.check(
		Schema.makeFilter((value) =>
			Result.isSuccess(Schema.decodeResult(Schema.DateTimeUtcFromString)(value)),
		),
	),
);
const jsonObject = Schema.Record(Schema.String, jsonValueSchema);
export const decodeArchiveJsonObject = Schema.decodeUnknownSync(jsonObject);

export const isArchiveJsonObject = (value: unknown): value is Record<string, JsonValue> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const ARCHIVE_SECTION_PATHS = [
	"profile.json",
	"private-plugins.ndjson",
	"client-renderers.ndjson",
	"installations.ndjson",
	"entities.ndjson",
	"entity-dependencies.ndjson",
	"relationships.ndjson",
	"events.ndjson",
	"saved-views.ndjson",
	"integrations.ndjson",
	"notification-subscriptions.ndjson",
] as const;

export type ArchiveSectionPath = (typeof ARCHIVE_SECTION_PATHS)[number];

export const ArchiveSectionManifest = strictStruct({
	sha256,
	count: nonNegativeInteger,
	path: Schema.Literals(ARCHIVE_SECTION_PATHS),
});
export type ArchiveSectionManifest = typeof ArchiveSectionManifest.Type;

export const ArchiveAssetManifest = strictStruct({
	sha256,
	size: nonNegativeInteger,
	contentType: Schema.String,
	path: Schema.String.pipe(
		Schema.check(Schema.makeFilter((value) => /^assets\/[a-f0-9]{64}$/.test(value))),
	),
});
export type ArchiveAssetManifest = typeof ArchiveAssetManifest.Type;

export const ArchiveRequiredPlugin = strictStruct({
	sourceHash: sha256,
	slug: Schema.String,
	version: Schema.String,
});
export type ArchiveRequiredPlugin = typeof ArchiveRequiredPlugin.Type;

export const ArchiveManifest = strictStruct({
	createdAt: isoTimestamp,
	archiveId: Schema.String,
	appVersion: Schema.String,
	version: Schema.Literal(1),
	format: Schema.Literal("ryot-backup"),
	redactions: Schema.Array(Schema.String),
	assets: Schema.Array(ArchiveAssetManifest),
	sections: Schema.Array(ArchiveSectionManifest),
	requiredPlugins: Schema.Array(ArchiveRequiredPlugin),
});
export type ArchiveManifest = typeof ArchiveManifest.Type;

export const ArchiveProfile = strictStruct({
	name: Schema.String,
	preferences: jsonObject,
	image: Schema.NullOr(Schema.String),
});
export type ArchiveProfile = typeof ArchiveProfile.Type;

export const ArchivePrivatePlugin = strictStruct({
	key: Schema.String,
	sourceHash: sha256,
	slug: Schema.String,
	version: Schema.String,
	manifest: PluginManifest,
	files: Schema.Record(Schema.String, CanonicalBase64),
});
export type ArchivePrivatePlugin = typeof ArchivePrivatePlugin.Type;

export const ArchiveInstallation = strictStruct({
	id: Schema.String,
	config: jsonObject,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	sortOrder: Schema.Finite,
	packageKey: Schema.String,
	disabledIntent: Schema.Boolean,
	homeSavedViewId: Schema.NullOr(Schema.String),
	configuredSecretPaths: Schema.Array(Schema.String),
	lifecycleIntent: Schema.Literals(["ready", "needs-configuration", "disabled"]),
});
export type ArchiveInstallation = typeof ArchiveInstallation.Type;

export const ArchiveClientRenderer = strictStruct({
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	draftRevision: Schema.Int,
	draftDefinition: ClientRendererDefinition,
	publishedHash: Schema.NullOr(Schema.String),
	publishedRevision: Schema.NullOr(Schema.Int),
	publishedDefinition: Schema.NullOr(ClientRendererDefinition),
});
export type ArchiveClientRenderer = typeof ArchiveClientRenderer.Type;

const providerProvenance = Schema.NullOr(
	strictStruct({ pluginKey: Schema.String, providerSlug: Schema.String }),
);

export const ArchiveUserEntity = strictStruct({
	id: Schema.String,
	name: Schema.String,
	properties: jsonObject,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	provider: providerProvenance,
	entitySchemaSlug: Schema.String,
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(isoTimestamp),
	entitySchemaPluginKey: Schema.NullOr(Schema.String),
});
export type ArchiveUserEntity = typeof ArchiveUserEntity.Type;

const ArchiveEntityTranslation = strictStruct({
	id: Schema.String,
	language: Schema.String,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	name: Schema.NullOr(Schema.String),
	properties: Schema.NullOr(jsonObject),
	populatedAt: Schema.NullOr(isoTimestamp),
});
type ArchiveEntityTranslation = typeof ArchiveEntityTranslation.Type;

const dependencyIdentity = Schema.Union([
	strictStruct({ kind: Schema.Literal("unmanaged") }),
	strictStruct({
		pluginKey: Schema.String,
		providerSlug: Schema.String,
		kind: Schema.Literal("provider"),
	}),
	strictStruct({
		pluginKey: Schema.String,
		externalId: Schema.String,
		entitySchemaSlug: Schema.String,
		kind: Schema.Literal("bootstrap"),
	}),
]);

export const ArchiveEntityDependency = strictStruct({
	id: Schema.String,
	name: Schema.String,
	properties: jsonObject,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	provider: providerProvenance,
	identity: dependencyIdentity,
	entitySchemaSlug: Schema.String,
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(isoTimestamp),
	entitySchemaPluginKey: Schema.NullOr(Schema.String),
	translations: Schema.Array(ArchiveEntityTranslation),
});
export type ArchiveEntityDependency = typeof ArchiveEntityDependency.Type;

export const ArchiveRelationship = strictStruct({
	id: Schema.String,
	properties: jsonObject,
	createdAt: isoTimestamp,
	sourceEntityId: Schema.String,
	targetEntityId: Schema.String,
	relationshipSchemaSlug: Schema.String,
	scope: Schema.Literals(["global", "user"]),
	relationshipSchemaPluginKey: Schema.NullOr(Schema.String),
});
export type ArchiveRelationship = typeof ArchiveRelationship.Type;

export const ArchiveEvent = strictStruct({
	id: Schema.String,
	properties: jsonObject,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	entityId: Schema.String,
	occurredAt: isoTimestamp,
	eventSchemaSlug: Schema.String,
	sessionEntityId: Schema.NullOr(Schema.String),
	eventSchemaPluginKey: Schema.NullOr(Schema.String),
});
export type ArchiveEvent = typeof ArchiveEvent.Type;

const savedViewFields = {
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	sortOrder: Schema.Finite,
	isDisabled: Schema.Boolean,
	pluginKey: Schema.NullOr(Schema.String),
	dataSources: Schema.NullOr(RyotQLDocument),
	settings: Schema.Record(Schema.String, jsonValueSchema),
	renderer: Schema.Union([
		strictStruct({ rendererId: Schema.String, kind: Schema.Literal("custom") }),
		strictStruct({ kind: Schema.Literal("kernel"), name: KernelSavedViewRendererName }),
		strictStruct({
			pluginKey: Schema.String,
			exportName: Schema.String,
			kind: Schema.Literal("plugin"),
		}),
	]),
};

export const ArchiveSavedView = Schema.Union([
	strictStruct({
		...savedViewFields,
		kind: Schema.Literal("custom"),
		isBuiltin: Schema.Literal(false),
	}),
	strictStruct({
		...savedViewFields,
		isBuiltin: Schema.Literal(true),
		kind: Schema.Literal("builtin-override"),
	}),
]);
export type ArchiveSavedView = typeof ArchiveSavedView.Type;

export const ArchiveIntegration = strictStruct({
	id: Schema.String,
	provider: Schema.String,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	packageKey: Schema.String,
	isDisabled: Schema.Boolean,
	syncOwnership: Schema.Boolean,
	providerSpecifics: jsonObject,
	minimumProgress: Schema.String,
	maximumProgress: Schema.String,
	name: Schema.NullOr(Schema.String),
	lastFinishedAt: Schema.NullOr(isoTimestamp),
	lot: Schema.Literals(["yank", "sink", "push"]),
	configuredSecretPaths: Schema.Array(Schema.String),
	extraSettings: strictStruct({ disableOnContinuousErrors: Schema.Boolean }),
});
export type ArchiveIntegration = typeof ArchiveIntegration.Type;

export const ArchiveNotificationSubscription = strictStruct({
	isActive: Schema.Boolean,
	signalSchemaSlug: Schema.String,
	metadata: Schema.NullOr(jsonValueSchema),
	signalSchemaPluginKey: Schema.NullOr(Schema.String),
});
export type ArchiveNotificationSubscription = typeof ArchiveNotificationSubscription.Type;

export const ARCHIVE_CODECS = {
	"events.ndjson": ArchiveEvent,
	"profile.json": ArchiveProfile,
	"entities.ndjson": ArchiveUserEntity,
	"saved-views.ndjson": ArchiveSavedView,
	"integrations.ndjson": ArchiveIntegration,
	"installations.ndjson": ArchiveInstallation,
	"relationships.ndjson": ArchiveRelationship,
	"private-plugins.ndjson": ArchivePrivatePlugin,
	"client-renderers.ndjson": ArchiveClientRenderer,
	"entity-dependencies.ndjson": ArchiveEntityDependency,
	"notification-subscriptions.ndjson": ArchiveNotificationSubscription,
} as const;

export type ArchiveRecords = {
	readonly profile: ArchiveProfile;
	readonly entities: ReadonlyArray<ArchiveUserEntity>;
	readonly savedViews: ReadonlyArray<ArchiveSavedView>;
	readonly integrations: ReadonlyArray<ArchiveIntegration>;
	readonly installations: ReadonlyArray<ArchiveInstallation>;
	readonly relationships: ReadonlyArray<ArchiveRelationship>;
	readonly privatePlugins: ReadonlyArray<ArchivePrivatePlugin>;
	readonly clientRenderers: ReadonlyArray<ArchiveClientRenderer>;
	readonly entityDependencies: ReadonlyArray<ArchiveEntityDependency>;
	readonly notificationSubscriptions: ReadonlyArray<ArchiveNotificationSubscription>;
};
