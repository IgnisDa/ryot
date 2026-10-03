import {
	PluginEntityUserStatePolicy,
	PluginSignalAudiencePolicy,
} from "@ryot-app/contract/modules/plugins/manifest";
import {
	definitionKey,
	definitionOwner,
	type DeclarationReference,
	type DefinitionOwner,
	type EventSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import {
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
	SavedViewRenderer,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { AppSchema, type PropertyValidationError } from "@ryot-app/contract/schema/property-schema";
import { Data, Effect, Result, Schema } from "effect";

import {
	formatPropertyIssues,
	parseAppSchemaProperties,
	validateAppSchemaDefinition,
} from "#lib/property-schema/property-schema-runtime";
import { savedViewDataSourceAccess, validateRyotQLDocument } from "#modules/ryotql/validator";

const pluginIdField = { pluginId: Schema.NullOr(Schema.String) };

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

export const SignalSchemaDefinition = Schema.Struct({
	...pluginIdField,
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: AppSchema,
	notificationHookSlug: Schema.String,
	audiencePolicy: PluginSignalAudiencePolicy,
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
	pluginSlug: Schema.NullOr(Schema.String),
	dataSources: Schema.NullOr(RyotQLDocument),
	settings: Schema.Record(Schema.String, JsonValue),
});

export type SavedViewDefinition = typeof SavedViewDefinition.Type;

export type DefinitionSource = {
	readonly savedViews: ReadonlyArray<SavedViewDefinition>;
	readonly signalSchemas: ReadonlyArray<SignalSchemaDefinition>;
	readonly relationshipSchemas: ReadonlyArray<RelationshipSchemaDefinition>;
	readonly entitySchemas: ReadonlyArray<
		Omit<EntitySchemaSourceDefinition, "eventSchemas"> & {
			readonly eventSchemas: ReadonlyArray<EventSchemaDefinition>;
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

export const EntityRelationshipDefinitions = Schema.Struct({
	relationshipSchemas: DefinitionSnapshot.fields.relationshipSchemas,
	entitySchemas: Schema.Record(
		Schema.String,
		Schema.Struct({
			slug: EntitySchemaDefinition.fields.slug,
			pluginId: EntitySchemaDefinition.fields.pluginId,
		}),
	),
});

export type EntityRelationshipDefinitions = typeof EntityRelationshipDefinitions.Type;

export class DefinitionNotFound extends Data.TaggedError("DefinitionNotFound")<{
	readonly kind: string;
	readonly slug: string;
	readonly owner: DefinitionOwner;
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

const assertUniqueSlugs = (
	kind: string,
	definitions: ReadonlyArray<{ readonly slug: string; readonly pluginId: string | null }>,
) => {
	const slugs = new Set<string>();
	for (const definition of definitions) {
		if (definition.slug.includes("/")) {
			throw new Error(`${kind} slug cannot contain '/': ${definition.slug}`);
		}
		const key = definitionKey(kind, definitionOwner(definition.pluginId), definition.slug);
		if (slugs.has(key)) {
			throw new Error(`Duplicate ${kind} slug: ${definition.slug}`);
		}
		slugs.add(key);
	}
};

const assertSchemaDefinition = (kind: string, slug: string, schema: AppSchema) => {
	const issues = validateAppSchemaDefinition(schema);
	if (issues.length > 0) {
		throw new Error(`Invalid ${kind} properties schema ${slug}: ${formatPropertyIssues(issues)}`);
	}
};

const validateSavedViewDefinition = (savedView: SavedViewDefinition) => {
	if (savedView.dataSources !== null) {
		const issue = validateRyotQLDocument(savedView.dataSources, savedViewDataSourceAccess);
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
		savedView.renderer.name === "entity-browser" || savedView.renderer.name === "collection-browser"
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

	const entitySchemaSlugs = new Set(
		source.entitySchemas.map(({ slug, pluginId }) =>
			definitionKey("entity", definitionOwner(pluginId), slug),
		),
	);
	const relationshipSchemaSlugs = new Set(
		source.relationshipSchemas.map(({ slug, pluginId }) =>
			definitionKey("relationship", definitionOwner(pluginId), slug),
		),
	);

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
			if (eventSchema.pluginId !== entitySchema.pluginId) {
				throw new Error(`Event schema ${eventSchema.slug} owner does not match its entity schema`);
			}
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
			if (
				entitySchemaSlug !== null &&
				!entitySchemaSlugs.has(
					definitionKey("entity", definitionOwner(relationshipSchema.pluginId), entitySchemaSlug),
				)
			) {
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
			!relationshipSchemaSlugs.has(
				definitionKey(
					"relationship",
					definitionOwner(signalSchema.pluginId),
					signalSchema.audiencePolicy.relationshipSchemaSlug,
				),
			)
		) {
			throw new Error(
				`Signal schema ${signalSchema.slug} references missing relationship schema ${signalSchema.audiencePolicy.relationshipSchemaSlug}`,
			);
		}
	}
};

const toRecord = <Definition extends { readonly slug: string; readonly pluginId: string | null }>(
	kind: string,
	definitions: ReadonlyArray<Definition>,
) =>
	Object.fromEntries(
		definitions.map((definition) => [
			definitionKey(kind, definitionOwner(definition.pluginId), definition.slug),
			definition,
		]),
	);

export const buildDefinitionSnapshot = (source: DefinitionSource): DefinitionSnapshot => {
	validateDefinitionSource(source);
	const cloned = structuredClone(source);
	return deepFreeze({
		savedViews: toRecord("saved-view", cloned.savedViews),
		signalSchemas: toRecord("signal", cloned.signalSchemas),
		relationshipSchemas: toRecord("relationship", cloned.relationshipSchemas),
		entitySchemas: Object.fromEntries(
			cloned.entitySchemas.map(({ eventSchemas, ...entitySchema }) => [
				definitionKey("entity", definitionOwner(entitySchema.pluginId), entitySchema.slug),
				{
					...entitySchema,
					mergeIdentityProperties: entitySchema.mergeIdentityProperties ?? [],
					eventSchemas: Object.fromEntries(
						eventSchemas.map((definition) => [definition.slug, definition]),
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

const validateProperties = (
	kind: string,
	slug: string,
	properties: unknown,
	propertiesSchema: AppSchema | undefined,
	owner: DefinitionOwner,
): Effect.Effect<Record<string, unknown>, DefinitionNotFound | PropertyValidationError> =>
	propertiesSchema
		? parseAppSchemaProperties({ kind, properties, propertiesSchema })
		: Effect.fail(new DefinitionNotFound({ kind, slug, owner }));

export const definitionLookup = (snapshot: DefinitionSnapshot) => {
	const getEntitySchema = ({ slug, owner }: DeclarationReference) =>
		snapshot.entitySchemas[definitionKey("entity", owner, slug)];
	const getSignalSchema = ({ slug, owner }: DeclarationReference) =>
		snapshot.signalSchemas[definitionKey("signal", owner, slug)];
	const getSavedView = ({ slug, owner }: DeclarationReference) =>
		snapshot.savedViews[definitionKey("saved-view", owner, slug)];
	const getRelationshipSchema = ({ slug, owner }: DeclarationReference) =>
		snapshot.relationshipSchemas[definitionKey("relationship", owner, slug)];
	const getEventSchema = ({ slug, owner, entitySchemaSlug }: EventSchemaReference) =>
		getEntitySchema({ owner, slug: entitySchemaSlug })?.eventSchemas[slug];
	const validateEntityProperties = (reference: DeclarationReference, properties: unknown) =>
		validateProperties(
			"Entity",
			reference.slug,
			properties,
			getEntitySchema(reference)?.propertiesSchema,
			reference.owner,
		);
	const validateEventProperties = (reference: EventSchemaReference, properties: unknown) =>
		validateProperties(
			"Event",
			`${reference.entitySchemaSlug}:${reference.slug}`,
			properties,
			getEventSchema(reference)?.propertiesSchema,
			reference.owner,
		);
	const validateSignalProperties = (reference: DeclarationReference, properties: unknown) =>
		validateProperties(
			"Signal",
			reference.slug,
			properties,
			getSignalSchema(reference)?.propertiesSchema,
			reference.owner,
		);
	const validateRelationshipProperties = (reference: DeclarationReference, properties: unknown) =>
		validateProperties(
			"Relationship",
			reference.slug,
			properties,
			getRelationshipSchema(reference)?.propertiesSchema,
			reference.owner,
		);

	return {
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
