import { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import { PluginManifest } from "@ryot/contract/modules/plugins/manifest";
import { jsonValueSchema, type JsonValue } from "@ryot/contract/modules/sandbox/wire";
import { SavedViewLayouts } from "@ryot/contract/modules/saved-views/schemas";
import { strictStruct } from "@ryot/contract/schema/utils";
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
			Result.isSuccess(Schema.decodeUnknownResult(Schema.DateTimeUtcFromString)(value)),
		),
	),
);
const jsonObject = Schema.Record(Schema.String, jsonValueSchema);

export const decodeV2JsonObject = Schema.decodeUnknownSync(jsonObject);

export const isV2JsonObject = (value: unknown): value is Record<string, JsonValue> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const V2_SECTION_PATHS = [
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

export type V2SectionPath = (typeof V2_SECTION_PATHS)[number];

export const V2SectionManifest = strictStruct({
	path: Schema.Literals(V2_SECTION_PATHS),
	count: nonNegativeInteger,
	sha256,
});
export type V2SectionManifest = typeof V2SectionManifest.Type;

export const V2AssetManifest = strictStruct({
	sha256,
	size: nonNegativeInteger,
	contentType: Schema.String,
	path: Schema.String.pipe(
		Schema.check(Schema.makeFilter((value) => /^assets\/[a-f0-9]{64}$/.test(value))),
	),
});
export type V2AssetManifest = typeof V2AssetManifest.Type;

export const V2RequiredPlugin = strictStruct({
	sourceHash: sha256,
	slug: Schema.String,
	version: Schema.String,
});
export type V2RequiredPlugin = typeof V2RequiredPlugin.Type;

export const V2Manifest = strictStruct({
	createdAt: isoTimestamp,
	archiveId: Schema.String,
	appVersion: Schema.String,
	version: Schema.Literal(2),
	assets: Schema.Array(V2AssetManifest),
	redactions: Schema.Array(Schema.String),
	format: Schema.Literal("ryot-backup"),
	sections: Schema.Array(V2SectionManifest),
	requiredPlugins: Schema.Array(V2RequiredPlugin),
});
export type V2Manifest = typeof V2Manifest.Type;

export const V2Profile = strictStruct({
	name: Schema.String,
	preferences: jsonObject,
	image: Schema.NullOr(Schema.String),
});
export type V2Profile = typeof V2Profile.Type;

export const V2PrivatePlugin = strictStruct({
	key: Schema.String,
	sourceHash: sha256,
	slug: Schema.String,
	version: Schema.String,
	manifest: PluginManifest,
	files: Schema.Record(Schema.String, Schema.String),
});
export type V2PrivatePlugin = typeof V2PrivatePlugin.Type;

export const V2Installation = strictStruct({
	id: Schema.String,
	config: jsonObject,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	sortOrder: Schema.Finite,
	packageKey: Schema.String,
	disabledIntent: Schema.Boolean,
	configuredSecretPaths: Schema.Array(Schema.String),
	lifecycleIntent: Schema.Literals(["ready", "needs-configuration", "disabled"]),
});
export type V2Installation = typeof V2Installation.Type;

const providerProvenance = Schema.NullOr(
	strictStruct({ pluginKey: Schema.String, providerSlug: Schema.String }),
);

export const V2UserEntity = strictStruct({
	id: Schema.String,
	name: Schema.String,
	properties: jsonObject,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	provider: providerProvenance,
	entitySchemaSlug: Schema.String,
	origin: Schema.NullOr(AutomationOrigin),
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(isoTimestamp),
	entitySchemaPluginKey: Schema.NullOr(Schema.String),
});
export type V2UserEntity = typeof V2UserEntity.Type;

const V2EntityTranslation = strictStruct({
	id: Schema.String,
	language: Schema.String,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	name: Schema.NullOr(Schema.String),
	properties: Schema.NullOr(jsonObject),
	populatedAt: Schema.NullOr(isoTimestamp),
});
type V2EntityTranslation = typeof V2EntityTranslation.Type;

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

export const V2EntityDependency = strictStruct({
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
	translations: Schema.Array(V2EntityTranslation),
	entitySchemaPluginKey: Schema.NullOr(Schema.String),
});
export type V2EntityDependency = typeof V2EntityDependency.Type;

export const V2Relationship = strictStruct({
	id: Schema.String,
	properties: jsonObject,
	createdAt: isoTimestamp,
	sourceEntityId: Schema.String,
	targetEntityId: Schema.String,
	relationshipSchemaSlug: Schema.String,
	scope: Schema.Literals(["global", "user"]),
	relationshipSchemaPluginKey: Schema.NullOr(Schema.String),
});
export type V2Relationship = typeof V2Relationship.Type;

export const V2Event = strictStruct({
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
export type V2Event = typeof V2Event.Type;

const savedViewFields = {
	id: Schema.String,
	slug: Schema.String,
	name: Schema.String,
	icon: Schema.String,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	sortOrder: Schema.Finite,
	layouts: SavedViewLayouts,
	isDisabled: Schema.Boolean,
	pluginKey: Schema.NullOr(Schema.String),
	entitySchemaSlug: Schema.NullOr(Schema.String),
	entitySchemaPluginKey: Schema.NullOr(Schema.String),
};

export const V2SavedView = Schema.Union([
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
export type V2SavedView = typeof V2SavedView.Type;

export const V2Integration = strictStruct({
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
export type V2Integration = typeof V2Integration.Type;

export const V2NotificationSubscription = strictStruct({
	isActive: Schema.Boolean,
	signalSchemaSlug: Schema.String,
	metadata: Schema.NullOr(jsonValueSchema),
	signalSchemaPluginKey: Schema.NullOr(Schema.String),
});
export type V2NotificationSubscription = typeof V2NotificationSubscription.Type;

export const V2_CODECS = {
	"events.ndjson": V2Event,
	"profile.json": V2Profile,
	"entities.ndjson": V2UserEntity,
	"saved-views.ndjson": V2SavedView,
	"integrations.ndjson": V2Integration,
	"installations.ndjson": V2Installation,
	"relationships.ndjson": V2Relationship,
	"private-plugins.ndjson": V2PrivatePlugin,
	"entity-dependencies.ndjson": V2EntityDependency,
	"notification-subscriptions.ndjson": V2NotificationSubscription,
} as const;

export type V2ArchiveRecords = {
	readonly profile: V2Profile;
	readonly entities: ReadonlyArray<V2UserEntity>;
	readonly savedViews: ReadonlyArray<V2SavedView>;
	readonly integrations: ReadonlyArray<V2Integration>;
	readonly installations: ReadonlyArray<V2Installation>;
	readonly relationships: ReadonlyArray<V2Relationship>;
	readonly privatePlugins: ReadonlyArray<V2PrivatePlugin>;
	readonly entityDependencies: ReadonlyArray<V2EntityDependency>;
	readonly notificationSubscriptions: ReadonlyArray<V2NotificationSubscription>;
};
