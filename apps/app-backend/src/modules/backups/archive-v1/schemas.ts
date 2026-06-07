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

export const V1_BOOTSTRAP_SOURCE = {
	name: "Library",
	pluginSlug: "media",
	entitySchemaSlug: "library",
} as const;

export const decodeV1JsonObject = Schema.decodeUnknownSync(jsonObject);

export const isV1JsonObject = (value: unknown): value is Record<string, JsonValue> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const V1_SECTION_PATHS = [
	"profile.json",
	"plugin-state.ndjson",
	"entities.ndjson",
	"entity-dependencies.ndjson",
	"relationships.ndjson",
	"events.ndjson",
	"saved-views.ndjson",
	"notification-subscriptions.ndjson",
] as const;

export type V1SectionPath = (typeof V1_SECTION_PATHS)[number];

export const V1SectionManifest = strictStruct({
	path: Schema.Literals(V1_SECTION_PATHS),
	count: nonNegativeInteger,
	sha256,
});
export type V1SectionManifest = typeof V1SectionManifest.Type;

export const V1AssetManifest = strictStruct({
	path: Schema.String.pipe(
		Schema.check(Schema.makeFilter((value) => /^assets\/[a-f0-9]{64}$/.test(value))),
	),
	size: nonNegativeInteger,
	sha256,
	contentType: Schema.String,
});
export type V1AssetManifest = typeof V1AssetManifest.Type;

export const V1RequiredPlugin = strictStruct({
	slug: Schema.String,
	version: Schema.String,
});
export type V1RequiredPlugin = typeof V1RequiredPlugin.Type;

export const V1Manifest = strictStruct({
	format: Schema.Literal("ryot-backup"),
	version: Schema.Literal(1),
	archiveId: Schema.String,
	appVersion: Schema.String,
	createdAt: isoTimestamp,
	sections: Schema.Array(V1SectionManifest),
	assets: Schema.Array(V1AssetManifest),
	requiredPlugins: Schema.Array(V1RequiredPlugin),
	redactions: Schema.Array(Schema.String),
});
export type V1Manifest = typeof V1Manifest.Type;

export const V1Profile = strictStruct({
	name: Schema.String,
	image: Schema.NullOr(Schema.String),
	preferences: jsonObject,
});
export type V1Profile = typeof V1Profile.Type;

export const V1PluginState = strictStruct({
	id: Schema.String,
	config: jsonObject,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	sortOrder: Schema.Finite,
	pluginSlug: Schema.String,
	isDisabled: Schema.Boolean,
});
export type V1PluginState = typeof V1PluginState.Type;

const providerProvenance = Schema.NullOr(
	strictStruct({ pluginSlug: Schema.String, providerSlug: Schema.String }),
);

export const V1UserEntity = strictStruct({
	id: Schema.String,
	name: Schema.String,
	properties: jsonObject,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	provider: providerProvenance,
	entitySchemaSlug: Schema.String,
	externalId: Schema.NullOr(Schema.String),
	populatedAt: Schema.NullOr(isoTimestamp),
});
export type V1UserEntity = typeof V1UserEntity.Type;

const V1EntityTranslation = strictStruct({
	id: Schema.String,
	language: Schema.String,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	name: Schema.NullOr(Schema.String),
	properties: Schema.NullOr(jsonObject),
	populatedAt: Schema.NullOr(isoTimestamp),
});
type V1EntityTranslation = typeof V1EntityTranslation.Type;

const dependencyIdentity = Schema.Union([
	strictStruct({ kind: Schema.Literal("unmanaged") }),
	strictStruct({
		pluginSlug: Schema.String,
		providerSlug: Schema.String,
		kind: Schema.Literal("provider"),
	}),
	strictStruct({
		pluginSlug: Schema.String,
		externalId: Schema.String,
		entitySchemaSlug: Schema.String,
		kind: Schema.Literal("bootstrap"),
	}),
]);

export const V1EntityDependency = strictStruct({
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
	translations: Schema.Array(V1EntityTranslation),
});
export type V1EntityDependency = typeof V1EntityDependency.Type;

export const V1Relationship = strictStruct({
	id: Schema.String,
	properties: jsonObject,
	createdAt: isoTimestamp,
	sourceEntityId: Schema.String,
	targetEntityId: Schema.String,
	relationshipSchemaSlug: Schema.String,
	scope: Schema.Literals(["global", "user"]),
});
export type V1Relationship = typeof V1Relationship.Type;

export const V1Event = strictStruct({
	id: Schema.String,
	properties: jsonObject,
	createdAt: isoTimestamp,
	updatedAt: isoTimestamp,
	entityId: Schema.String,
	occurredAt: isoTimestamp,
	eventSchemaSlug: Schema.String,
	sessionEntityId: Schema.NullOr(Schema.String),
});
export type V1Event = typeof V1Event.Type;

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
	pluginSlug: Schema.NullOr(Schema.String),
	entitySchemaSlug: Schema.NullOr(Schema.String),
};

export const V1SavedView = Schema.Union([
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
export type V1SavedView = typeof V1SavedView.Type;

export const V1NotificationSubscription = strictStruct({
	isActive: Schema.Boolean,
	signalSchemaSlug: Schema.String,
	metadata: Schema.NullOr(jsonValueSchema),
});
export type V1NotificationSubscription = typeof V1NotificationSubscription.Type;

export const V1_CODECS = {
	"events.ndjson": V1Event,
	"profile.json": V1Profile,
	"entities.ndjson": V1UserEntity,
	"saved-views.ndjson": V1SavedView,
	"plugin-state.ndjson": V1PluginState,
	"relationships.ndjson": V1Relationship,
	"entity-dependencies.ndjson": V1EntityDependency,
	"notification-subscriptions.ndjson": V1NotificationSubscription,
} as const;

export type V1ArchiveRecords = {
	readonly profile: V1Profile;
	readonly events: ReadonlyArray<V1Event>;
	readonly entities: ReadonlyArray<V1UserEntity>;
	readonly savedViews: ReadonlyArray<V1SavedView>;
	readonly pluginState: ReadonlyArray<V1PluginState>;
	readonly relationships: ReadonlyArray<V1Relationship>;
	readonly entityDependencies: ReadonlyArray<V1EntityDependency>;
	readonly notificationSubscriptions: ReadonlyArray<V1NotificationSubscription>;
};
