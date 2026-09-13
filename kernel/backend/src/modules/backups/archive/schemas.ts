import { PluginClientArtifactFromBase64 } from "@ryot-app/client-plugin-contract";
import {
	DataRecordProperties,
	DataRecordTimestamp,
	dataJsonSource,
	entityDataFields,
	eventDataFields,
	relationshipDataFields,
} from "@ryot-app/contract/modules/imports/data-json";
import { PluginManifest } from "@ryot-app/contract/modules/plugins/manifest";
import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import { jsonValueSchema, type JsonValue } from "@ryot-app/contract/modules/sandbox/wire";
import { KernelSavedViewRendererName } from "@ryot-app/contract/modules/saved-views/schemas";
import { CanonicalBase64 } from "@ryot-app/contract/schema/base64";
import { strictStruct } from "@ryot-app/contract/schema/utils";
import { Schema } from "effect";

const nonNegativeInteger = Schema.Finite.pipe(
	Schema.check(Schema.isInt()),
	Schema.check(Schema.isGreaterThanOrEqualTo(0)),
);
const positiveInteger = Schema.Finite.pipe(
	Schema.check(Schema.isInt()),
	Schema.check(Schema.isGreaterThanOrEqualTo(1)),
);
const sha256 = Schema.String.pipe(
	Schema.check(Schema.makeFilter((value) => /^[a-f0-9]{64}$/.test(value))),
);
export const decodeArchiveJsonObject = Schema.decodeUnknownSync(DataRecordProperties);

export const isArchiveJsonObject = (value: unknown): value is Record<string, JsonValue> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const ARCHIVE_SECTION_PATHS = [
	"profile.json",
	"private-plugins.ndjson",
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
	archiveId: Schema.String,
	appVersion: Schema.String,
	version: Schema.Literal(1),
	createdAt: DataRecordTimestamp,
	format: Schema.Literal("ryot-backup"),
	redactions: Schema.Array(Schema.String),
	assets: Schema.Array(ArchiveAssetManifest),
	sections: Schema.Array(ArchiveSectionManifest),
	requiredPlugins: Schema.Array(ArchiveRequiredPlugin),
});
export type ArchiveManifest = typeof ArchiveManifest.Type;

export const ArchiveProfile = strictStruct({
	name: Schema.String,
	preferences: DataRecordProperties,
	image: Schema.NullOr(Schema.String),
});
export type ArchiveProfile = typeof ArchiveProfile.Type;

export const ArchivePluginCompiledScript = strictStruct({
	entry: Schema.String,
	source: Schema.String,
	format: positiveInteger,
	javascript: Schema.String,
});
export type ArchivePluginCompiledScript = typeof ArchivePluginCompiledScript.Type;

export const ArchivePrivatePlugin = strictStruct({
	key: Schema.String,
	sourceHash: sha256,
	slug: Schema.String,
	version: Schema.String,
	manifest: PluginManifest,
	files: Schema.Record(Schema.String, CanonicalBase64),
	compiledScripts: Schema.Array(ArchivePluginCompiledScript),
	compiledClient: Schema.optional(PluginClientArtifactFromBase64),
});
export type ArchivePrivatePlugin = typeof ArchivePrivatePlugin.Type;

export const ArchiveInstallation = strictStruct({
	id: Schema.String,
	sortOrder: Schema.Finite,
	packageKey: Schema.String,
	config: DataRecordProperties,
	hiddenIntent: Schema.Boolean,
	createdAt: DataRecordTimestamp,
	updatedAt: DataRecordTimestamp,
	userSettings: DataRecordProperties,
	homeSavedViewSlug: Schema.NullOr(Schema.String),
	configuredSecretPaths: Schema.Array(Schema.String),
	lifecycleIntent: Schema.Literals(["ready", "needs-configuration", "hidden"]),
});
export type ArchiveInstallation = typeof ArchiveInstallation.Type;

const providerProvenance = Schema.NullOr(
	strictStruct({ pluginKey: Schema.String, providerSlug: Schema.String }),
);

export const ArchiveUserEntity = strictStruct({
	id: Schema.String,
	...entityDataFields,
	provider: providerProvenance,
	createdAt: DataRecordTimestamp,
	updatedAt: DataRecordTimestamp,
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(DataRecordTimestamp),
	entitySchemaPluginKey: Schema.NullOr(Schema.String),
});
export type ArchiveUserEntity = typeof ArchiveUserEntity.Type;

const ArchiveEntityTranslation = strictStruct({
	language: Schema.String,
	createdAt: DataRecordTimestamp,
	updatedAt: DataRecordTimestamp,
	name: Schema.NullOr(Schema.String),
	properties: Schema.NullOr(DataRecordProperties),
	populatedAt: Schema.NullOr(DataRecordTimestamp),
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
	...entityDataFields,
	provider: providerProvenance,
	identity: dependencyIdentity,
	createdAt: DataRecordTimestamp,
	updatedAt: DataRecordTimestamp,
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(DataRecordTimestamp),
	entitySchemaPluginKey: Schema.NullOr(Schema.String),
	translations: Schema.Array(ArchiveEntityTranslation),
});
export type ArchiveEntityDependency = typeof ArchiveEntityDependency.Type;

export const ArchiveRelationship = strictStruct({
	id: Schema.String,
	...relationshipDataFields,
	sourceEntityId: Schema.String,
	targetEntityId: Schema.String,
	createdAt: DataRecordTimestamp,
	scope: Schema.Literals(["global", "user"]),
	relationshipSchemaPluginKey: Schema.NullOr(Schema.String),
});
export type ArchiveRelationship = typeof ArchiveRelationship.Type;

export const ArchiveEvent = strictStruct({
	id: Schema.String,
	...eventDataFields,
	entityId: Schema.String,
	createdAt: DataRecordTimestamp,
	updatedAt: DataRecordTimestamp,
	sessionEntityId: Schema.NullOr(Schema.String),
	eventSchemaPluginKey: Schema.NullOr(Schema.String),
});
export type ArchiveEvent = typeof ArchiveEvent.Type;

const savedViewFields = {
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	sortOrder: Schema.Finite,
	isHidden: Schema.Boolean,
	createdAt: DataRecordTimestamp,
	updatedAt: DataRecordTimestamp,
	pluginKey: Schema.NullOr(Schema.String),
	dataSources: Schema.NullOr(RyotQLDocument),
	settings: Schema.Record(Schema.String, jsonValueSchema),
	renderer: Schema.Union([
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
		id: Schema.String,
		slug: Schema.String,
		sortOrder: Schema.Finite,
		isHidden: Schema.Boolean,
		isBuiltin: Schema.Literal(true),
		pluginKey: Schema.NullOr(Schema.String),
		kind: Schema.Literal("builtin-override"),
	}),
]);
export type ArchiveSavedView = typeof ArchiveSavedView.Type;

export const ArchiveIntegration = strictStruct({
	id: Schema.String,
	provider: Schema.String,
	isDisabled: Schema.Boolean,
	syncOwnership: Schema.Boolean,
	createdAt: DataRecordTimestamp,
	updatedAt: DataRecordTimestamp,
	minimumProgress: Schema.String,
	maximumProgress: Schema.String,
	name: Schema.NullOr(Schema.String),
	providerSpecifics: DataRecordProperties,
	packageKey: Schema.NullOr(Schema.String),
	lot: Schema.Literals(["yank", "sink", "push"]),
	lastFinishedAt: Schema.NullOr(DataRecordTimestamp),
	configuredSecretPaths: Schema.Array(Schema.String),
	extraSettings: strictStruct({ disableOnContinuousErrors: Schema.Boolean }),
}).pipe(
	Schema.check(
		Schema.makeFilter((record) =>
			record.packageKey === null
				? record.provider === dataJsonSource && record.lot === "sink"
				: record.provider !== dataJsonSource,
		),
	),
);
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
	readonly entityDependencies: ReadonlyArray<ArchiveEntityDependency>;
	readonly notificationSubscriptions: ReadonlyArray<ArchiveNotificationSubscription>;
};
