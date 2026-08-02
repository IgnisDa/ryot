import { PluginEntityUserStatePolicy } from "@ryot-app/contract/modules/plugins/manifest";
import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import {
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
	SavedViewRenderer,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { AppSchema, type PropertyValidationError } from "@ryot-app/contract/schema/property-schema";
import { Context, Data, Effect, Layer, Result, Schema } from "effect";

import {
	formatPropertyIssues,
	parseAppSchemaProperties,
	validateAppSchemaDefinition,
} from "#lib/property-schema/property-schema-runtime";
import { validateRyotQLDocument } from "#modules/ryotql/validator";

import { kernelDefinitionSource } from "./kernel-source";

const pluginIdField = { pluginId: Schema.optional(Schema.NullOr(Schema.String)) };

export const EventSchemaDefinition = Schema.Struct({
	...pluginIdField,
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: AppSchema,
});

export type EventSchemaDefinition = typeof EventSchemaDefinition.Type;

export const EntitySchemaDefinition = Schema.Struct({
	...pluginIdField,
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: AppSchema,
	pluginSlug: Schema.NullOr(Schema.String),
	eventSchemas: Schema.Array(EventSchemaDefinition),
	mergeIdentityProperties: Schema.Array(Schema.String),
	userState: Schema.optional(PluginEntityUserStatePolicy),
});

export type EntitySchemaDefinition = typeof EntitySchemaDefinition.Type;

type EntitySchemaSourceDefinition = Omit<EntitySchemaDefinition, "mergeIdentityProperties"> & {
	readonly mergeIdentityProperties?: ReadonlyArray<string> | undefined;
};

export const RelationshipSchemaDefinition = Schema.Struct({
	...pluginIdField,
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: AppSchema,
	sourceEntitySchemaSlug: Schema.NullOr(Schema.String),
	targetEntitySchemaSlug: Schema.NullOr(Schema.String),
});

export type RelationshipSchemaDefinition = typeof RelationshipSchemaDefinition.Type;

export const SignalAudiencePolicy = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("actor") }),
	Schema.Struct({
		kind: Schema.Literal("related_users"),
		relationshipSchemaSlug: Schema.String,
		subjectSide: Schema.Literals(["source", "target"]),
	}),
]);

export type SignalAudiencePolicy = typeof SignalAudiencePolicy.Type;

export const SignalSchemaDefinition = Schema.Struct({
	...pluginIdField,
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: AppSchema,
	audiencePolicy: SignalAudiencePolicy,
	notificationScriptSlug: Schema.String,
	catalogState: Schema.Literals(["active", "hidden"]),
});

export type SignalSchemaDefinition = typeof SignalSchemaDefinition.Type;

export const SavedViewDefinition = Schema.Struct({
	...pluginIdField,
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	sortOrder: Schema.Finite,
	renderer: SavedViewRenderer,
	dataSources: Schema.NullOr(RyotQLDocument),
	settings: Schema.Record(Schema.String, JsonValue),
	pluginSlug: Schema.NullOr(Schema.String),
});

export type SavedViewDefinition = typeof SavedViewDefinition.Type;

type SourceDefinition<Definition> = Omit<Definition, "pluginId"> & {
	readonly pluginId?: string | null | undefined;
};

export type DefinitionSource = {
	readonly savedViews: ReadonlyArray<SourceDefinition<SavedViewDefinition>>;
	readonly signalSchemas: ReadonlyArray<SourceDefinition<SignalSchemaDefinition>>;
	readonly relationshipSchemas: ReadonlyArray<SourceDefinition<RelationshipSchemaDefinition>>;
	readonly entitySchemas: ReadonlyArray<
		Omit<EntitySchemaSourceDefinition, "eventSchemas" | "pluginId"> & {
			readonly pluginId?: string | null | undefined;
			readonly eventSchemas: ReadonlyArray<SourceDefinition<EventSchemaDefinition>>;
		}
	>;
};

export const EntitySchemaSnapshot = Schema.Struct({
	...EntitySchemaDefinition.fields,
	eventSchemas: Schema.Record(Schema.String, EventSchemaDefinition),
});

export type EntitySchemaSnapshot = typeof EntitySchemaSnapshot.Type;

export const DefinitionSnapshot = Schema.Struct({
	savedViews: Schema.Record(Schema.String, SavedViewDefinition),
	entitySchemas: Schema.Record(Schema.String, EntitySchemaSnapshot),
	signalSchemas: Schema.Record(Schema.String, SignalSchemaDefinition),
	relationshipSchemas: Schema.Record(Schema.String, RelationshipSchemaDefinition),
});

export type DefinitionSnapshot = typeof DefinitionSnapshot.Type;

export class DefinitionNotFound extends Data.TaggedError("DefinitionNotFound")<{
	readonly kind: string;
	readonly slug: string;
}> {}

const deepFreeze = <Value>(value: Value): Value => {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
		return value;
	}
	for (const child of Object.values(value)) {
		deepFreeze(child);
	}
	return Object.freeze(value);
};

const assertUniqueSlugs = (kind: string, definitions: ReadonlyArray<{ readonly slug: string }>) => {
	const slugs = new Set<string>();
	for (const definition of definitions) {
		if (definition.slug.includes("/")) {
			throw new Error(`${kind} slug cannot contain '/': ${definition.slug}`);
		}
		if (slugs.has(definition.slug)) {
			throw new Error(`Duplicate ${kind} slug: ${definition.slug}`);
		}
		slugs.add(definition.slug);
	}
};

const assertSchemaDefinition = (kind: string, slug: string, schema: AppSchema) => {
	const issues = validateAppSchemaDefinition(schema);
	if (issues.length > 0) {
		throw new Error(`Invalid ${kind} properties schema ${slug}: ${formatPropertyIssues(issues)}`);
	}
};

const validateSavedViewDefinition = (savedView: SourceDefinition<SavedViewDefinition>) => {
	if (savedView.dataSources !== null) {
		const issue = validateRyotQLDocument(savedView.dataSources);
		if (issue) {
			throw new Error(`Invalid saved view ${savedView.slug}: ${issue}`);
		}
		for (const [name, query] of Object.entries(savedView.dataSources.queries)) {
			if (query.output.type === "rows" && "after" in query.output.pagination) {
				throw new Error(`Invalid saved view ${savedView.slug}: source '${name}' contains a cursor`);
			}
		}
	}
	if (savedView.renderer.kind !== "kernel") {
		return;
	}
	const settingsSchema =
		savedView.renderer.name === "entity-browser"
			? EntityBrowserSavedViewSettings
			: ResultsTableSavedViewSettings;
	const decoded = Schema.decodeUnknownResult(settingsSchema)(savedView.settings);
	if (Result.isFailure(decoded)) {
		throw new Error(
			`Invalid saved view ${savedView.slug}: invalid ${savedView.renderer.name} settings`,
		);
	}
	if (savedView.dataSources === null) {
		throw new Error(`Invalid saved view ${savedView.slug}: data sources are required`);
	}
	const source = savedView.dataSources.queries[decoded.success.sourceName];
	if (source?.output.type !== "rows") {
		throw new Error(
			`Invalid saved view ${savedView.slug}: source '${decoded.success.sourceName}' must produce rows`,
		);
	}
};

const validateDefinitionSource = (source: DefinitionSource) => {
	assertUniqueSlugs("entity schema", source.entitySchemas);
	assertUniqueSlugs("relationship schema", source.relationshipSchemas);
	assertUniqueSlugs("signal schema", source.signalSchemas);
	assertUniqueSlugs("saved view", source.savedViews);

	const entitySchemaSlugs = new Set(source.entitySchemas.map(({ slug }) => slug));
	const relationshipSchemaSlugs = new Set(source.relationshipSchemas.map(({ slug }) => slug));

	for (const savedView of source.savedViews) {
		validateSavedViewDefinition(savedView);
	}

	for (const entitySchema of source.entitySchemas) {
		assertSchemaDefinition("entity", entitySchema.slug, entitySchema.propertiesSchema);
		const mergeIdentityProperties = entitySchema.mergeIdentityProperties ?? [];
		const uniqueMergeIdentityProperties = new Set(mergeIdentityProperties);
		if (mergeIdentityProperties.some((property) => property.length === 0)) {
			throw new Error(
				`Entity schema ${entitySchema.slug} merge identity property names cannot be empty`,
			);
		}
		if (uniqueMergeIdentityProperties.size !== mergeIdentityProperties.length) {
			throw new Error(`Entity schema ${entitySchema.slug} has duplicate merge identity properties`);
		}
		for (const property of mergeIdentityProperties) {
			if (!Object.hasOwn(entitySchema.propertiesSchema.fields, property)) {
				throw new Error(
					`Entity schema ${entitySchema.slug} merge identity property '${property}' is not defined in its properties schema`,
				);
			}
		}
		assertUniqueSlugs(`event schema for ${entitySchema.slug}`, entitySchema.eventSchemas);
		for (const eventSchema of entitySchema.eventSchemas) {
			assertSchemaDefinition(
				"event",
				`${entitySchema.slug}:${eventSchema.slug}`,
				eventSchema.propertiesSchema,
			);
		}
	}

	for (const relationshipSchema of source.relationshipSchemas) {
		assertSchemaDefinition(
			"relationship",
			relationshipSchema.slug,
			relationshipSchema.propertiesSchema,
		);
		for (const entitySchemaSlug of [
			relationshipSchema.sourceEntitySchemaSlug,
			relationshipSchema.targetEntitySchemaSlug,
		]) {
			if (entitySchemaSlug !== null && !entitySchemaSlugs.has(entitySchemaSlug)) {
				throw new Error(
					`Relationship schema ${relationshipSchema.slug} references missing entity schema ${entitySchemaSlug}`,
				);
			}
		}
	}

	for (const signalSchema of source.signalSchemas) {
		assertSchemaDefinition("signal", signalSchema.slug, signalSchema.propertiesSchema);
		if (
			signalSchema.audiencePolicy.kind === "related_users" &&
			!relationshipSchemaSlugs.has(signalSchema.audiencePolicy.relationshipSchemaSlug)
		) {
			throw new Error(
				`Signal schema ${signalSchema.slug} references missing relationship schema ${signalSchema.audiencePolicy.relationshipSchemaSlug}`,
			);
		}
	}
};

const toRecord = <Definition extends { readonly slug: string }>(
	definitions: ReadonlyArray<Definition>,
) => Object.fromEntries(definitions.map((definition) => [definition.slug, definition]));

export const buildDefinitionSnapshot = (source: DefinitionSource): DefinitionSnapshot => {
	validateDefinitionSource(source);
	const cloned = structuredClone(source);
	return deepFreeze({
		savedViews: toRecord(
			cloned.savedViews.map((definition) => ({
				...definition,
				pluginId: definition.pluginId ?? null,
			})),
		),
		signalSchemas: toRecord(
			cloned.signalSchemas.map((definition) => ({
				...definition,
				pluginId: definition.pluginId ?? null,
			})),
		),
		relationshipSchemas: toRecord(
			cloned.relationshipSchemas.map((definition) => ({
				...definition,
				pluginId: definition.pluginId ?? null,
			})),
		),
		entitySchemas: Object.fromEntries(
			cloned.entitySchemas.map(({ eventSchemas, ...entitySchema }) => [
				entitySchema.slug,
				{
					...entitySchema,
					pluginId: entitySchema.pluginId ?? null,
					mergeIdentityProperties: entitySchema.mergeIdentityProperties ?? [],
					eventSchemas: toRecord(
						eventSchemas.map((definition) => ({
							...definition,
							pluginId: definition.pluginId ?? entitySchema.pluginId ?? null,
						})),
					),
				},
			]),
		),
	});
};

export const definitionSourceFromSnapshot = (snapshot: DefinitionSnapshot): DefinitionSource => ({
	savedViews: Object.values(snapshot.savedViews),
	signalSchemas: Object.values(snapshot.signalSchemas),
	relationshipSchemas: Object.values(snapshot.relationshipSchemas),
	entitySchemas: Object.values(snapshot.entitySchemas).map(({ eventSchemas, ...entitySchema }) =>
		Object.assign({}, entitySchema, { eventSchemas: Object.values(eventSchemas) }),
	),
});

export const makeDefinitionRegistry = (source: DefinitionSource = kernelDefinitionSource()) => {
	let snapshot = buildDefinitionSnapshot(source);
	const getSnapshot = () => snapshot;
	const replace = (nextSource: DefinitionSource) => {
		snapshot = buildDefinitionSnapshot(nextSource);
	};
	const getEntitySchema = (slug: string) => snapshot.entitySchemas[slug];
	const getSignalSchema = (slug: string) => snapshot.signalSchemas[slug];
	const getSavedView = (slug: string) => snapshot.savedViews[slug];
	const getRelationshipSchema = (slug: string) => snapshot.relationshipSchemas[slug];
	const getEventSchema = (entitySchemaSlug: string, eventSchemaSlug: string) =>
		getEntitySchema(entitySchemaSlug)?.eventSchemas[eventSchemaSlug];
	const validateProperties = (
		kind: string,
		slug: string,
		properties: unknown,
		propertiesSchema: AppSchema | undefined,
	): Effect.Effect<Record<string, unknown>, DefinitionNotFound | PropertyValidationError> =>
		propertiesSchema
			? parseAppSchemaProperties({ kind, properties, propertiesSchema })
			: Effect.fail(new DefinitionNotFound({ kind, slug }));
	const validateEntityProperties = (slug: string, properties: unknown) =>
		validateProperties("Entity", slug, properties, getEntitySchema(slug)?.propertiesSchema);
	const validateEventProperties = (
		entitySchemaSlug: string,
		eventSchemaSlug: string,
		properties: unknown,
	) =>
		validateProperties(
			"Event",
			`${entitySchemaSlug}:${eventSchemaSlug}`,
			properties,
			getEventSchema(entitySchemaSlug, eventSchemaSlug)?.propertiesSchema,
		);
	const validateSignalProperties = (slug: string, properties: unknown) =>
		validateProperties("Signal", slug, properties, getSignalSchema(slug)?.propertiesSchema);
	const validateRelationshipProperties = (slug: string, properties: unknown) =>
		validateProperties(
			"Relationship",
			slug,
			properties,
			getRelationshipSchema(slug)?.propertiesSchema,
		);

	return {
		replace,
		getSnapshot,
		getSavedView,
		getEventSchema,
		getEntitySchema,
		getSignalSchema,
		getRelationshipSchema,
		validateEventProperties,
		validateEntityProperties,
		validateSignalProperties,
		validateRelationshipProperties,
	};
};

export class DefinitionRegistry extends Context.Service<DefinitionRegistry>()(
	"DefinitionRegistry",
	{ make: Effect.sync(makeDefinitionRegistry) },
) {
	static readonly layer = Layer.effect(this, this.make);
}
