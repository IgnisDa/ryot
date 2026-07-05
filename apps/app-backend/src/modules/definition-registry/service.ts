import type { DisplayConfiguration } from "@ryot/contract/display-configuration";
import type { QueryDocument } from "@ryot/contract/modules/query-engine/language";
import { RelationshipSchemaSlug } from "@ryot/contract/schema/brands";
import type { AppSchema, PropertyValidationError } from "@ryot/contract/schema/property-schema";
import { buildDefaultSavedViewQueryDocument } from "@ryot/query-engine/recipes/app";
import { Data, Effect } from "effect";

import {
	formatPropertyIssues,
	parseAppSchemaProperties,
	validateAppSchemaDefinition,
} from "#lib/property-schema/property-schema-runtime";
import { builtinEntitySchemas } from "#modules/builtins/entity-schemas";
import { builtinRelationshipSchemas } from "#modules/builtins/relationship-schemas";
import { builtinSavedViews } from "#modules/builtins/saved-views";
import { builtinSignalSchemas } from "#modules/builtins/signal-schemas";
import { builtinTrackers } from "#modules/builtins/trackers";

export type EventSchemaDefinition = {
	readonly name: string;
	readonly slug: string;
	readonly propertiesSchema: AppSchema;
};

export type EntitySchemaDefinition = {
	readonly icon: string;
	readonly name: string;
	readonly slug: string;
	readonly accentColor: string;
	readonly propertiesSchema: AppSchema;
	readonly eventSchemas: ReadonlyArray<EventSchemaDefinition>;
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
	readonly catalogState: "active" | "hidden";
	readonly propertiesSchema: AppSchema;
	readonly audiencePolicy: SignalAudiencePolicy;
};

export type TrackerDefinition = {
	readonly icon: string;
	readonly name: string;
	readonly slug: string;
	readonly accentColor: string;
	readonly description: string;
	readonly entitySchemaSlugs: ReadonlyArray<string>;
};

export type SavedViewDefinition = {
	readonly icon: string;
	readonly name: string;
	readonly slug: string;
	readonly sortOrder: number;
	readonly accentColor: string;
	readonly queryDocument: QueryDocument;
	readonly trackerSlug: string | null;
	readonly displayConfiguration: DisplayConfiguration;
};

export type DefinitionSource = {
	readonly trackers: ReadonlyArray<TrackerDefinition>;
	readonly savedViews: ReadonlyArray<SavedViewDefinition>;
	readonly entitySchemas: ReadonlyArray<EntitySchemaDefinition>;
	readonly signalSchemas: ReadonlyArray<SignalSchemaDefinition>;
	readonly relationshipSchemas: ReadonlyArray<RelationshipSchemaDefinition>;
};

type EntitySchemaSnapshot = Omit<EntitySchemaDefinition, "eventSchemas"> & {
	readonly eventSchemas: Readonly<Record<string, EventSchemaDefinition>>;
};

export type DefinitionSnapshot = {
	readonly trackers: Readonly<Record<string, TrackerDefinition>>;
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

const validateDefinitionSource = (source: DefinitionSource) => {
	assertUniqueSlugs("entity schema", source.entitySchemas);
	assertUniqueSlugs("relationship schema", source.relationshipSchemas);
	assertUniqueSlugs("signal schema", source.signalSchemas);
	assertUniqueSlugs("tracker", source.trackers);
	assertUniqueSlugs("saved view", source.savedViews);

	const trackerSlugs = new Set(source.trackers.map(({ slug }) => slug));
	const entitySchemaSlugs = new Set(source.entitySchemas.map(({ slug }) => slug));
	const relationshipSchemaSlugs = new Set(source.relationshipSchemas.map(({ slug }) => slug));

	for (const entitySchema of source.entitySchemas) {
		assertSchemaDefinition("entity", entitySchema.slug, entitySchema.propertiesSchema);
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

	for (const tracker of source.trackers) {
		for (const entitySchemaSlug of tracker.entitySchemaSlugs) {
			if (!entitySchemaSlugs.has(entitySchemaSlug)) {
				throw new Error(
					`Tracker ${tracker.slug} references missing entity schema ${entitySchemaSlug}`,
				);
			}
		}
	}

	for (const savedView of source.savedViews) {
		if (savedView.trackerSlug !== null && !trackerSlugs.has(savedView.trackerSlug)) {
			throw new Error(
				`Saved view ${savedView.slug} references missing tracker ${savedView.trackerSlug}`,
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
		trackers: toRecord(cloned.trackers),
		savedViews: toRecord(cloned.savedViews),
		signalSchemas: toRecord(cloned.signalSchemas),
		relationshipSchemas: toRecord(cloned.relationshipSchemas),
		entitySchemas: Object.fromEntries(
			cloned.entitySchemas.map(({ eventSchemas, ...entitySchema }) => [
				entitySchema.slug,
				{ ...entitySchema, eventSchemas: toRecord(eventSchemas) },
			]),
		),
	});
};

export const definitionSourceFromSnapshot = (snapshot: DefinitionSnapshot): DefinitionSource => ({
	trackers: Object.values(snapshot.trackers),
	savedViews: Object.values(snapshot.savedViews),
	signalSchemas: Object.values(snapshot.signalSchemas),
	relationshipSchemas: Object.values(snapshot.relationshipSchemas),
	entitySchemas: Object.values(snapshot.entitySchemas).map(({ eventSchemas, ...entitySchema }) =>
		Object.assign({}, entitySchema, { eventSchemas: Object.values(eventSchemas) }),
	),
});

export const builtinDefinitionSource = (): DefinitionSource => {
	const entitySchemas = builtinEntitySchemas();
	const entitySchemasBySlug = new Map(
		entitySchemas.map((definition) => [definition.slug, definition]),
	);
	const trackers = builtinTrackers().map((tracker) => ({
		icon: tracker.icon,
		name: tracker.name,
		slug: tracker.slug,
		accentColor: tracker.accentColor,
		description: tracker.description,
		entitySchemaSlugs: entitySchemas
			.filter(({ trackerSlug }) => trackerSlug === tracker.slug)
			.map(({ slug }) => slug),
	}));
	const sortOrders = new Map<string | null, number>();
	const savedViews = builtinSavedViews().map((savedView) => {
		const trackerSlug = savedView.trackerSlug ?? null;
		const sortOrder = sortOrders.get(trackerSlug) ?? 0;
		sortOrders.set(trackerSlug, sortOrder + 1);
		const entitySchema = savedView.entitySchemaSlug
			? entitySchemasBySlug.get(savedView.entitySchemaSlug)
			: undefined;
		const icon = savedView.icon ?? entitySchema?.icon;
		const accentColor = savedView.accentColor ?? entitySchema?.accentColor;
		const queryDocument =
			savedView.queryDocument ??
			(entitySchema
				? buildDefaultSavedViewQueryDocument({
						schemas: [entitySchema.slug],
						requireInLibrary: savedView.requireInLibrary,
					})
				: undefined);
		if (!icon || !accentColor || !queryDocument) {
			throw new Error(`Builtin saved view ${savedView.slug} is incomplete`);
		}
		return {
			icon,
			sortOrder,
			accentColor,
			queryDocument,
			trackerSlug,
			name: savedView.name,
			slug: savedView.slug,
			displayConfiguration: savedView.displayConfiguration,
		};
	});
	const signalSchemas = builtinSignalSchemas(RelationshipSchemaSlug.make("media-monitoring")).map(
		(signalSchema) => ({
			name: signalSchema.name,
			slug: signalSchema.slug,
			catalogState: signalSchema.catalogState,
			propertiesSchema: signalSchema.propertiesSchema,
			audiencePolicy:
				signalSchema.audiencePolicy.kind === "actor"
					? signalSchema.audiencePolicy
					: {
							kind: signalSchema.audiencePolicy.kind,
							subjectSide: signalSchema.audiencePolicy.subjectSide,
							relationshipSchemaSlug: signalSchema.audiencePolicy.relationshipSchemaSlug,
						},
		}),
	);
	return {
		trackers,
		savedViews,
		entitySchemas,
		signalSchemas,
		relationshipSchemas: builtinRelationshipSchemas(),
	};
};

export const makeDefinitionRegistry = (source: DefinitionSource = builtinDefinitionSource()) => {
	let snapshot = buildDefinitionSnapshot(source);
	const getSnapshot = () => snapshot;
	const replace = (nextSource: DefinitionSource) => {
		snapshot = buildDefinitionSnapshot(nextSource);
	};
	const getEntitySchema = (slug: string) => snapshot.entitySchemas[slug];
	const getSignalSchema = (slug: string) => snapshot.signalSchemas[slug];
	const getTracker = (slug: string) => snapshot.trackers[slug];
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
		getTracker,
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

export class DefinitionRegistry extends Effect.Service<DefinitionRegistry>()("DefinitionRegistry", {
	sync: makeDefinitionRegistry,
}) {}
