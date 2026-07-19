import type { PluginEntitySchema } from "@ryot/contract/modules/plugins/manifest";
import type {
	FieldSelection,
	RyotQLDocument,
	RowSelection,
} from "@ryot/contract/modules/ryotql/language";
import type { SavedViewLayouts } from "@ryot/contract/modules/saved-views/schemas";
import type { AppSchema, PropertyValidationError } from "@ryot/contract/schema/property-schema";
import { Context, Data, Effect, Layer } from "effect";

import {
	formatPropertyIssues,
	parseAppSchemaProperties,
	validateAppSchemaDefinition,
} from "#lib/property-schema/property-schema-runtime";
import { getCatalogTable, type CatalogTable } from "#modules/ryotql/catalog";
import { expressionKind, validateRyotQLDocument } from "#modules/ryotql/validator";

import { kernelDefinitionSource } from "./kernel-source";

export type EventSchemaDefinition = {
	readonly name: string;
	readonly slug: string;
	readonly propertiesSchema: AppSchema;
};

export type EntitySchemaDefinition = {
	readonly icon: string;
	readonly name: string;
	readonly slug: string;
	readonly pluginSlug: string | null;
	readonly propertiesSchema: AppSchema;
	readonly userState?: PluginEntitySchema["userState"];
	readonly mergeIdentityProperties: ReadonlyArray<string>;
	readonly eventSchemas: ReadonlyArray<EventSchemaDefinition>;
};

type EntitySchemaSourceDefinition = Omit<EntitySchemaDefinition, "mergeIdentityProperties"> & {
	readonly mergeIdentityProperties?: ReadonlyArray<string> | undefined;
};

export type RelationshipSchemaDefinition = {
	readonly name: string;
	readonly slug: string;
	readonly propertiesSchema: AppSchema;
	readonly sourceEntitySchemaSlug: string | null;
	readonly targetEntitySchemaSlug: string | null;
};

export type SignalAudiencePolicy =
	| { readonly kind: "actor" }
	| {
			readonly kind: "related_users";
			readonly subjectSide: "source" | "target";
			readonly relationshipSchemaSlug: string;
	  };

export type SignalSchemaDefinition = {
	readonly name: string;
	readonly slug: string;
	readonly propertiesSchema: AppSchema;
	readonly notificationScriptSlug: string;
	readonly catalogState: "active" | "hidden";
	readonly audiencePolicy: SignalAudiencePolicy;
};

export type SavedViewDefinition = {
	readonly icon: string;
	readonly name: string;
	readonly slug: string;
	readonly sortOrder: number;
	readonly pluginSlug: string | null;
	readonly layouts: SavedViewLayouts;
	readonly entitySchemaSlug: string | null;
};

export type DefinitionSource = {
	readonly savedViews: ReadonlyArray<SavedViewDefinition>;
	readonly signalSchemas: ReadonlyArray<SignalSchemaDefinition>;
	readonly entitySchemas: ReadonlyArray<EntitySchemaSourceDefinition>;
	readonly relationshipSchemas: ReadonlyArray<RelationshipSchemaDefinition>;
};

type EntitySchemaSnapshot = Omit<EntitySchemaDefinition, "eventSchemas"> & {
	readonly eventSchemas: Readonly<Record<string, EventSchemaDefinition>>;
};

export type DefinitionSnapshot = {
	readonly savedViews: Readonly<Record<string, SavedViewDefinition>>;
	readonly entitySchemas: Readonly<Record<string, EntitySchemaSnapshot>>;
	readonly signalSchemas: Readonly<Record<string, SignalSchemaDefinition>>;
	readonly relationshipSchemas: Readonly<Record<string, RelationshipSchemaDefinition>>;
};

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

const cardFields = (card: SavedViewLayouts["grid"]) =>
	[
		card.titleField,
		card.imageField,
		card.overlineField,
		card.calloutField,
		card.primaryMetadataField,
		card.secondaryMetadataField,
	].filter((field): field is string => field !== null);

const rootScope = (document: RyotQLDocument) => {
	const [query] = Object.values(document.queries);
	const scope = new Map<string, CatalogTable>();
	if (!query) {
		return scope;
	}
	for (const reference of [query.from, ...(query.joins ?? []).map(({ table }) => table)]) {
		const table = getCatalogTable(reference.table);
		if (table) {
			scope.set(reference.alias, table);
		}
	}
	return scope;
};

const isFieldSelection = (selection: RowSelection): selection is FieldSelection =>
	"key" in selection;

const displayExpression = (fields: readonly FieldSelection[], field: string) =>
	fields.find((selection) => selection.key === field);

type SavedViewLayout = SavedViewLayouts[keyof SavedViewLayouts];

const getLayoutValidationError = (
	layoutName: keyof SavedViewLayouts,
	layout: SavedViewLayout,
): string | null => {
	const queryDocument = layout.queryDocument;
	const queries = Object.entries(queryDocument.queries);
	if (queries.length !== 1) {
		return "must contain exactly one named query";
	}

	const query = queries[0]?.[1];
	if (query?.output.type !== "rows") {
		return "query must have rows output";
	}
	if ("after" in query.output.pagination) {
		return "query pagination must not contain a cursor";
	}
	if (query.output.fields.some((selection) => !isFieldSelection(selection))) {
		return "query must use explicit field selections";
	}
	if (query.output.include !== undefined) {
		return "query must not include nested results";
	}
	if (layoutName === "table" && "columns" in layout && layout.columns.length === 0) {
		return "must have at least one column";
	}

	const semanticError = validateRyotQLDocument(queryDocument);
	if (semanticError) {
		return semanticError;
	}

	const rootFields = query.output.fields.filter(isFieldSelection);
	const projectionKeys = new Set(rootFields.map((selection) => selection.key));
	const configuredFields =
		"columns" in layout
			? [layout.entityIdField, layout.imageField, ...layout.columns.map(({ field }) => field)]
			: [layout.entityIdField, ...cardFields(layout)];
	for (const field of configuredFields) {
		if (field === null) {
			continue;
		}
		if (!projectionKeys.has(field)) {
			return `mapping field '${field}' is not in its root projection`;
		}
	}

	const scope = rootScope(queryDocument);
	const textFields = [
		{ field: layout.entityIdField, slot: "entityIdField" },
		...("titleField" in layout ? [{ field: layout.titleField, slot: "titleField" }] : []),
	];
	for (const { field, slot } of textFields) {
		const selection = displayExpression(rootFields, field);
		if (!selection) {
			return `mapping field '${field}' is not in its root projection`;
		}
		if (expressionKind(selection.expr, scope) !== "text") {
			return `${slot} must resolve to text`;
		}
	}
	const entityIdSelection = displayExpression(rootFields, layout.entityIdField);
	const entityIdTable =
		entityIdSelection?.expr.type === "column"
			? scope.get(entityIdSelection.expr.tableAlias)
			: undefined;
	if (
		entityIdSelection?.expr.type !== "column" ||
		entityIdTable?.name !== "entity" ||
		entityIdSelection.expr.field !== entityIdTable.primaryKey
	) {
		return "entityIdField must project an entity primary key";
	}
	const imageField = layout.imageField;
	for (const { field, slot } of imageField === null
		? []
		: [{ field: imageField, slot: "imageField" }]) {
		const selection = displayExpression(rootFields, field);
		if (!selection) {
			return `mapping field '${field}' is not in its root projection`;
		}
		if (selection.expr.type !== "cast" || selection.expr.target !== "json") {
			return `${slot} must use an explicit JSON cast for AssetLocator`;
		}
	}

	return null;
};

export const getSavedViewValidationError = (input: { readonly layouts: SavedViewLayouts }) => {
	for (const layoutName of ["grid", "list", "table"] as const) {
		const error = getLayoutValidationError(layoutName, input.layouts[layoutName]);
		if (error) {
			return `${layoutName[0]?.toUpperCase()}${layoutName.slice(1)} layout: ${error}`;
		}
	}
	return null;
};

const validateDefinitionSource = (source: DefinitionSource) => {
	assertUniqueSlugs("entity schema", source.entitySchemas);
	assertUniqueSlugs("relationship schema", source.relationshipSchemas);
	assertUniqueSlugs("signal schema", source.signalSchemas);
	assertUniqueSlugs("saved view", source.savedViews);

	const entitySchemaSlugs = new Set(source.entitySchemas.map(({ slug }) => slug));
	const relationshipSchemaSlugs = new Set(source.relationshipSchemas.map(({ slug }) => slug));

	for (const savedView of source.savedViews) {
		const validationError = getSavedViewValidationError(savedView);
		if (validationError) {
			throw new Error(`Invalid saved view ${savedView.slug}: ${validationError}`);
		}
		if (savedView.entitySchemaSlug !== null && !entitySchemaSlugs.has(savedView.entitySchemaSlug)) {
			throw new Error(
				`Saved view ${savedView.slug} references missing entity schema ${savedView.entitySchemaSlug}`,
			);
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
		savedViews: toRecord(cloned.savedViews),
		signalSchemas: toRecord(cloned.signalSchemas),
		relationshipSchemas: toRecord(cloned.relationshipSchemas),
		entitySchemas: Object.fromEntries(
			cloned.entitySchemas.map(({ eventSchemas, ...entitySchema }) => [
				entitySchema.slug,
				{
					...entitySchema,
					eventSchemas: toRecord(eventSchemas),
					mergeIdentityProperties: entitySchema.mergeIdentityProperties ?? [],
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
	{
		make: Effect.sync(makeDefinitionRegistry),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
