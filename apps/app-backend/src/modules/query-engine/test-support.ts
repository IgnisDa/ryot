import { PgDialect } from "drizzle-orm/pg-core";

import type { AppSchema } from "#lib/property-schema";
import type { QueryExpression, QueryFilter } from "#lib/query-language";
import {
	buildEventJoinMap,
	buildRelationshipJoinMap,
	buildSchemaMap,
	type QueryEngineEventSchemaLike,
} from "#lib/views/reference";

import type { QueryEngineContext } from "./context";
import { createQueryCompiler, createScalarExpressionCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";

const smartphonePropertiesSchema = {
	fields: {
		metadata: {
			label: "Metadata",
			type: "object",
			description: "Device metadata",
			properties: {
				source: { label: "Source", type: "string", description: "Metadata source" },
			},
		},
		nameplate: { label: "Nameplate", type: "string", description: "Device name" },
		tags: {
			label: "Tags",
			type: "array",
			description: "Device tags",
			items: { label: "Tag", type: "string", description: "Tag value" },
		},
		releasedAt: {
			label: "Released At",
			type: "datetime",
			description: "Release datetime",
		},
		announcedAt: { label: "Announced At", type: "date", description: "Announce date" },
		screenSize: { label: "Screen Size", type: "number", description: "Screen size" },
		releaseYear: { label: "Release Year", type: "integer", description: "Release year" },
		isFoldable: { label: "Is Foldable", type: "boolean", description: "Foldable flag" },
		manufacturer: {
			label: "Manufacturer",
			type: "string",
			description: "Device maker",
		},
	},
} satisfies AppSchema;

const tabletPropertiesSchema = {
	fields: {
		maker: { label: "Maker", type: "string", description: "Tablet maker" },
	},
} satisfies AppSchema;

const reviewEventPropertiesSchema = {
	fields: {
		rating: { label: "Rating", type: "number", description: "Review rating" },
	},
} satisfies AppSchema;

const relationshipPropertiesSchema = {
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

export const reviewEventSchemas = [
	{
		id: "event-schema-smartphones-review",
		slug: "review",
		entitySchemaId: "schema-smartphones",
		entitySchemaSlug: "smartphones",
		propertiesSchema: reviewEventPropertiesSchema,
	},
	{
		id: "event-schema-tablets-review",
		slug: "review",
		entitySchemaId: "schema-tablets",
		entitySchemaSlug: "tablets",
		propertiesSchema: reviewEventPropertiesSchema,
	},
] satisfies QueryEngineEventSchemaLike[];

export const reviewJoin = {
	key: "review",
	kind: "latestEvent" as const,
	eventSchemaSlug: "review",
	eventSchemas: reviewEventSchemas,
	eventSchemaMap: new Map(
		reviewEventSchemas.map((eventSchema) => [eventSchema.entitySchemaSlug, eventSchema]),
	),
};

export const ownershipJoin = {
	key: "ownership",
	kind: "latestRelationship" as const,
	propertiesSchema: relationshipPropertiesSchema,
	relationshipSchemaSlug: "ownership",
	sourceEntitySchema: smartphoneSchema,
	targetEntitySchema: smartphoneSchema,
};

export const context = {
	schemaMap: buildSchemaMap([smartphoneSchema, tabletSchema]),
	eventJoinMap: buildEventJoinMap([reviewJoin]),
	eventSchemaMap: new Map([["review", reviewEventSchemas]]),
	relationshipJoinMap: buildRelationshipJoinMap([ownershipJoin]),
} satisfies QueryEngineContext;

export const singleSchemaContext = {
	schemaMap: buildSchemaMap([smartphoneSchema]),
	eventJoinMap: buildEventJoinMap([]),
} satisfies QueryEngineContext;

export const dialect = new PgDialect();

type ComparisonOperator = Extract<QueryFilter, { type: "comparison" }>["operator"];

export const createComputedFieldExpression = (key: string): QueryExpression => ({
	type: "reference",
	reference: { type: "computed-field", key },
});

export const createEventJoinPropertyExpression = (
	joinKey: string,
	property: string,
): QueryExpression => ({
	type: "reference",
	reference: { type: "event-join", joinKey, path: ["properties", property] },
});

export const comparison = (
	left: QueryExpression,
	operator: ComparisonOperator,
	right: QueryExpression,
): QueryFilter => ({ type: "comparison", left, right, operator });

export const createScalarTestCompiler = (
	input: Omit<Parameters<typeof createScalarExpressionCompiler>[0], "getTypeInfo">,
) => {
	const getTypeInfo = createExpressionTypeResolver({
		context: input.context,
		computedFields: input.computedFields,
	});

	return createScalarExpressionCompiler({ ...input, getTypeInfo });
};

export const createQueryTestCompiler = (
	input: Omit<Parameters<typeof createQueryCompiler>[0], "getTypeInfo">,
) => {
	const getTypeInfo = createExpressionTypeResolver({
		context: input.context,
		computedFields: input.computedFields,
	});

	return createQueryCompiler({ ...input, getTypeInfo });
};
