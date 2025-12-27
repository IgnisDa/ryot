import type { AppSchema } from "#lib/property-schema";
import {
	createEntityColumnExpression,
	createLiteralExpression,
	type QueryExpression,
	type QueryFilter,
} from "#lib/query-language";

import {
	buildEventJoinMap,
	buildRelationshipJoinMap,
	buildSchemaMap,
	type QueryEngineEventJoinLike,
	type QueryEngineEventSchemaLike,
	type QueryEngineReferenceContext,
	type QueryEngineRelationshipJoinLike,
} from "./reference";

export const smartphonePropertiesSchema = {
	fields: {
		nameplate: { label: "Nameplate", type: "string", description: "Device name" },
		screenSize: { label: "Screen Size", type: "number", description: "Screen size" },
		announcedAt: { label: "Announced At", type: "date", description: "Announce date" },
		isFoldable: { label: "Is Foldable", type: "boolean", description: "Foldable flag" },
		manufacturer: { type: "string", label: "Manufacturer", description: "Device maker" },
		releaseYear: { label: "Release Year", type: "integer", description: "Release year" },
		releasedAt: { type: "datetime", label: "Released At", description: "Release datetime" },
		metadata: {
			type: "object",
			label: "Metadata",
			description: "Device metadata",
			properties: { source: { label: "Source", type: "string", description: "Metadata source" } },
		},
		tags: {
			label: "Tags",
			type: "array",
			description: "Device tags",
			items: { label: "Tag", type: "string", description: "Tag value" },
		},
	},
} satisfies AppSchema;

export const tabletPropertiesSchema = {
	fields: {
		maker: { label: "Maker", type: "string", description: "Tablet maker" },
		releaseYear: { label: "Release Year", type: "integer", description: "Release year" },
	},
} satisfies AppSchema;

export const collectionPropertiesSchema = { fields: {} } satisfies AppSchema;

export const relationshipPropertiesSchema = {
	fields: {
		rating: { label: "Rating", type: "integer", description: "Owner rating" },
		tags: {
			label: "Tags",
			type: "array",
			description: "Ownership tags",
			items: { label: "Tag", type: "string", description: "Ownership tag" },
		},
	},
} satisfies AppSchema;

export const smartphoneSchema = {
	slug: "smartphones",
	propertiesSchema: smartphonePropertiesSchema,
};

export const tabletSchema = {
	slug: "tablets",
	propertiesSchema: tabletPropertiesSchema,
};

export const collectionSchema = {
	slug: "collection",
	propertiesSchema: collectionPropertiesSchema,
};

export const context = {
	eventJoinMap: buildEventJoinMap<QueryEngineEventJoinLike>([]),
	schemaMap: buildSchemaMap([smartphoneSchema, tabletSchema, collectionSchema]),
} satisfies QueryEngineReferenceContext;

export const relationshipJoin = {
	key: "ownership",
	kind: "latestRelationship" as const,
	relationshipSchemaSlug: "ownership",
	sourceEntitySchema: smartphoneSchema,
	targetEntitySchema: smartphoneSchema,
	propertiesSchema: relationshipPropertiesSchema,
} satisfies QueryEngineRelationshipJoinLike;

export const entitiesContext = {
	...context,
	relationshipJoinMap: buildRelationshipJoinMap([relationshipJoin]),
} satisfies QueryEngineReferenceContext;

type ComparisonOperator = Extract<QueryFilter, { type: "comparison" }>["operator"];

export const comparison = (
	left: QueryExpression,
	operator: ComparisonOperator,
	right: QueryExpression,
): QueryFilter => ({ left, right, operator, type: "comparison" });

export const createEventSchema = (
	input: {
		id?: string;
		slug?: string;
		entitySchemaId?: string;
		entitySchemaSlug?: string;
		propertiesSchema?: AppSchema;
	} = {},
) =>
	({
		slug: input.slug ?? "review",
		id: input.id ?? "review-smartphone",
		entitySchemaId: input.entitySchemaId ?? "smartphones-id",
		entitySchemaSlug: input.entitySchemaSlug ?? "smartphones",
		propertiesSchema:
			input.propertiesSchema ??
			({
				fields: { rating: { label: "Rating", type: "integer", description: "Review score" } },
			} satisfies AppSchema),
	}) satisfies QueryEngineEventSchemaLike;

export const createEventJoin = (
	eventSchemas: ReadonlyArray<QueryEngineEventSchemaLike>,
	key = "review",
) =>
	({
		key,
		eventSchemaSlug: key,
		kind: "latestEvent" as const,
		eventSchemas: [...eventSchemas],
		eventSchemaMap: new Map(
			eventSchemas.map((eventSchema) => [eventSchema.entitySchemaSlug, eventSchema]),
		),
	}) satisfies QueryEngineEventJoinLike;

export const minimalEntitiesRequest = {
	fields: [],
	filter: null,
	eventJoins: [],
	computedFields: [],
	relationshipJoins: [],
	scope: ["smartphones"],
	mode: "entities" as const,
	pagination: { page: 1, limit: 10 },
	sort: {
		direction: "asc" as const,
		expression: createEntityColumnExpression("smartphones", "name"),
	},
};

export const literal = (value: unknown) => createLiteralExpression(value);
