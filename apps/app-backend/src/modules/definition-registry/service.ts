import type { DisplayConfiguration } from "@ryot/contract/display-configuration";
import type { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import type { AppSchema, PropertyValidationError } from "@ryot/contract/schema/property-schema";
import { Data, Effect } from "effect";

import {
	formatPropertyIssues,
	parseAppSchemaProperties,
	validateAppSchemaDefinition,
} from "#lib/property-schema/property-schema-runtime";

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
	readonly accentColor: string;
	readonly propertiesSchema: AppSchema;
	readonly eventSchemas: ReadonlyArray<EventSchemaDefinition>;
	readonly mergeIdentityProperties: ReadonlyArray<string>;
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
	readonly accentColor: string;
	readonly pluginSlug: string | null;
	readonly queryDocument: QueryDocument;
	readonly displayConfiguration: DisplayConfiguration;
};

export type DefinitionSource = {
	readonly savedViews: ReadonlyArray<SavedViewDefinition>;
	readonly entitySchemas: ReadonlyArray<EntitySchemaSourceDefinition>;
	readonly signalSchemas: ReadonlyArray<SignalSchemaDefinition>;
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

export type DefinitionProvenance = {
	readonly nonBuiltinEntitySchemaSlugs: ReadonlySet<string>;
	readonly nonBuiltinRelationshipSchemaSlugs: ReadonlySet<string>;
};

const builtinDefinitionProvenance = (): DefinitionProvenance => ({
	nonBuiltinEntitySchemaSlugs: new Set(),
	nonBuiltinRelationshipSchemaSlugs: new Set(),
});

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

const validateDefinitionSource = (source: DefinitionSource) => {
	assertUniqueSlugs("entity schema", source.entitySchemas);
	assertUniqueSlugs("relationship schema", source.relationshipSchemas);
	assertUniqueSlugs("signal schema", source.signalSchemas);
	assertUniqueSlugs("saved view", source.savedViews);

	const entitySchemaSlugs = new Set(source.entitySchemas.map(({ slug }) => slug));
	const relationshipSchemaSlugs = new Set(source.relationshipSchemas.map(({ slug }) => slug));

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

export const makeDefinitionRegistry = (
	source: DefinitionSource = kernelDefinitionSource(),
	initialProvenance: DefinitionProvenance = builtinDefinitionProvenance(),
) => {
	let snapshot = buildDefinitionSnapshot(source);
	let provenance = initialProvenance;
	const getSnapshot = () => snapshot;
	const replace = (
		nextSource: DefinitionSource,
		nextProvenance: DefinitionProvenance = builtinDefinitionProvenance(),
	) => {
		snapshot = buildDefinitionSnapshot(nextSource);
		provenance = nextProvenance;
	};
	const getEntitySchema = (slug: string) => snapshot.entitySchemas[slug];
	const getSignalSchema = (slug: string) => snapshot.signalSchemas[slug];
	const getSavedView = (slug: string) => snapshot.savedViews[slug];
	const getRelationshipSchema = (slug: string) => snapshot.relationshipSchemas[slug];
	const isEntitySchemaBuiltin = (slug: string) =>
		getEntitySchema(slug) !== undefined && !provenance.nonBuiltinEntitySchemaSlugs.has(slug);
	const isRelationshipSchemaBuiltin = (slug: string) =>
		getRelationshipSchema(slug) !== undefined &&
		!provenance.nonBuiltinRelationshipSchemaSlugs.has(slug);
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
		isEntitySchemaBuiltin,
		validateEventProperties,
		validateEntityProperties,
		validateSignalProperties,
		isRelationshipSchemaBuiltin,
		validateRelationshipProperties,
	};
};

export class DefinitionRegistry extends Effect.Service<DefinitionRegistry>()("DefinitionRegistry", {
	sync: makeDefinitionRegistry,
}) {}
