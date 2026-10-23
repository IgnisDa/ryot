import {
	CalendarSourcePrecision,
	CalendarSourceQuery,
} from "@ryot-app/contract/modules/calendar-sources/schemas";
import {
	PluginEntityEditor,
	PluginEntityUserStatePolicy,
	PluginEventProjection,
	PluginRelationshipUserWritePolicy,
	PluginSignalAudiencePolicy,
} from "@ryot-app/contract/modules/plugins/manifest";
import {
	type DeclarationReference,
	definitionKey,
	type DefinitionOwner,
	definitionOwner,
	type EventSchemaReference,
} from "@ryot-app/contract/modules/plugins/references";
import { RyotQLDocument } from "@ryot-app/contract/modules/ryotql/language";
import {
	EntityBrowserSavedViewSettings,
	ResultsTableSavedViewSettings,
	SavedViewRenderer,
	SavedViewSubject,
} from "@ryot-app/contract/modules/saved-views/schemas";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { AppSchema, type PropertyValidationError } from "@ryot-app/contract/schema/property-schema";
import { Data, Effect, Result, Schema } from "effect";

import { calendarSourceIssue } from "#modules/definitions/calendar-source-validation";
import {
	formatPropertyIssues,
	parseAppSchemaProperties,
	validateAppSchemaDefinition,
} from "#modules/definitions/properties/runtime";
import { filterFieldIssues } from "#modules/definitions/saved-view-filters";
import { savedViewDataSourceAccess, validateRyotQLDocument } from "#modules/ryotql/validator";

const pluginIdField = { pluginId: Schema.NullOr(Schema.String) };

export const EventSchemaDefinition = Schema.Struct({
	...pluginIdField,
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: AppSchema,
	projection: Schema.optional(PluginEventProjection),
});

export type EventSchemaDefinition = typeof EventSchemaDefinition.Type;

export const EntitySchemaDefinition = Schema.Struct({
	...pluginIdField,
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	propertiesSchema: AppSchema,
	editor: Schema.optional(PluginEntityEditor),
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
	userWritePolicy: Schema.optional(PluginRelationshipUserWritePolicy),
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
	dataSources: Schema.NullOr(RyotQLDocument),
	settings: Schema.Record(Schema.String, JsonValue),
});

export type SavedViewDefinition = typeof SavedViewDefinition.Type;

export const CalendarSourceDefinition = Schema.Struct({
	icon: Schema.String,
	name: Schema.String,
	slug: Schema.String,
	startAt: Schema.String,
	pluginId: Schema.String,
	subject: SavedViewSubject,
	query: CalendarSourceQuery,
	art: Schema.NullOr(Schema.String),
	done: Schema.NullOr(Schema.String),
	precision: CalendarSourcePrecision,
	caption: Schema.NullOr(Schema.String),
});

export type CalendarSourceDefinition = typeof CalendarSourceDefinition.Type;

export type DefinitionSource = {
	readonly savedViews: ReadonlyArray<SavedViewDefinition>;
	readonly calendarSources: ReadonlyArray<CalendarSourceDefinition>;
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
	calendarSources: Schema.Record(Schema.String, CalendarSourceDefinition),
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

const definitionLabels = {
	entity: "entity schema",
	signal: "signal schema",
	"saved-view": "saved view",
	relationship: "relationship schema",
	"calendar-source": "calendar source",
} as const;

export type DefinitionKind = keyof typeof definitionLabels;

export const definitionRecord = <
	Definition extends { readonly slug: string; readonly pluginId: string | null },
>(
	kind: DefinitionKind,
	definitions: ReadonlyArray<Definition>,
) => {
	const record: Record<string, Definition> = {};
	for (const definition of definitions) {
		if (definition.slug.includes("/")) {
			throw new Error(`${definitionLabels[kind]} slug cannot contain '/': ${definition.slug}`);
		}
		const key = definitionKey(kind, definitionOwner(definition.pluginId), definition.slug);
		if (Object.hasOwn(record, key)) {
			throw new Error(`Duplicate ${definitionLabels[kind]} slug: ${definition.slug}`);
		}
		record[key] = definition;
	}
	return record;
};

const assertUniqueEventSlugs = (
	entitySchemaSlug: string,
	eventSchemas: ReadonlyArray<{ readonly slug: string }>,
) => {
	const slugs = new Set<string>();
	for (const { slug } of eventSchemas) {
		if (slug.includes("/")) {
			throw new Error(`event schema for ${entitySchemaSlug} slug cannot contain '/': ${slug}`);
		}
		if (slugs.has(slug)) {
			throw new Error(`Duplicate event schema for ${entitySchemaSlug} slug: ${slug}`);
		}
		slugs.add(slug);
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
	if (savedView.renderer.name === "calendar") {
		if (savedView.dataSources !== null || Object.keys(savedView.settings).length > 0) {
			throw new Error(
				`Invalid saved view ${savedView.slug}: calendar views take no settings or data sources`,
			);
		}
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
	const filterIssue = filterFieldIssues({
		query: source,
		settings: decoded.success,
		renderer: savedView.renderer.name,
	});
	if (filterIssue) {
		throw new Error(`Invalid saved view ${savedView.slug}: ${filterIssue}`);
	}
};

const validateDefinitionSource = (
	source: DefinitionSource,
	entitySchemas: Record<string, unknown>,
	relationshipSchemas: Record<string, unknown>,
) => {
	for (const savedView of source.savedViews) {
		validateSavedViewDefinition(savedView);
	}
	for (const calendarSource of source.calendarSources) {
		const issue = calendarSourceIssue(calendarSource);
		if (issue) {
			throw new Error(`Invalid calendar source ${calendarSource.slug}: ${issue}`);
		}
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
		for (const relationshipSlug of entitySchema.editor?.relationships ?? []) {
			const relationship = source.relationshipSchemas.find(
				(candidate) =>
					candidate.slug === relationshipSlug && candidate.pluginId === entitySchema.pluginId,
			);
			if (relationship?.sourceEntitySchemaSlug !== entitySchema.slug) {
				throw new Error(
					`Entity schema ${entitySchema.slug} editor relationship ${relationshipSlug} must be an owned relationship from it`,
				);
			}
		}
		assertUniqueEventSlugs(entitySchema.slug, entitySchema.eventSchemas);
		for (const eventSchema of entitySchema.eventSchemas) {
			if (eventSchema.pluginId !== entitySchema.pluginId) {
				throw new Error(`Event schema ${eventSchema.slug} owner does not match its entity schema`);
			}
			assertSchemaDefinition(
				"event",
				`${entitySchema.slug}:${eventSchema.slug}`,
				eventSchema.propertiesSchema,
			);
			if (eventSchema.projection) {
				assertSchemaDefinition(
					"event projection",
					`${entitySchema.slug}:${eventSchema.slug}`,
					eventSchema.projection.propertiesSchema,
				);
			}
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
				!Object.hasOwn(
					entitySchemas,
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
			!Object.hasOwn(
				relationshipSchemas,
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

export const buildDefinitionSnapshot = (source: DefinitionSource): DefinitionSnapshot => {
	const cloned = structuredClone(source);
	const savedViews = definitionRecord("saved-view", cloned.savedViews);
	const calendarSources = definitionRecord("calendar-source", cloned.calendarSources);
	const signalSchemas = definitionRecord("signal", cloned.signalSchemas);
	const entitySchemas = definitionRecord("entity", cloned.entitySchemas);
	const relationshipSchemas = definitionRecord("relationship", cloned.relationshipSchemas);
	validateDefinitionSource(cloned, entitySchemas, relationshipSchemas);
	return deepFreeze({
		savedViews,
		signalSchemas,
		calendarSources,
		relationshipSchemas,
		entitySchemas: Object.fromEntries(
			Object.entries(entitySchemas).map(([key, { eventSchemas, ...entitySchema }]) => [
				key,
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
	calendarSources: Object.values(snapshot.calendarSources),
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
