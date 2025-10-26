import { describe, expect, it } from "bun:test";

import {
	createComputedFieldExpression,
	createEntityColumnExpression,
	createEventAggregateExpression,
} from "@ryot/ts-utils";

import {
	comparisonPredicate,
	createSmartphoneSchema,
	literalExpression,
} from "~/lib/test-fixtures";
import { createListedEntitySchema } from "~/lib/test-fixtures/entity-schemas";
import { createDefaultDisplayConfiguration } from "~/modules/saved-views";

import { buildRelationshipJoinMap, buildSchemaMap, displayBuiltins } from "./reference";
import {
	validateQueryEngineReferences,
	validateRuntimeReferenceAgainstSchemas,
	validateSavedViewDisplayConfiguration,
} from "./validator";

const context = {
	eventJoinMap: new Map(),
	schemaMap: buildSchemaMap([
		createSmartphoneSchema(),
		createListedEntitySchema({ slug: "collection" }),
	]),
};

describe("validateRuntimeReferenceAgainstSchemas", () => {
	it("rejects primary event references before event-first modes are implemented", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{
					type: "event",
					eventSchemaSlug: "review",
					path: ["properties", "rating"],
				},
				context,
				displayBuiltins,
			),
		).toThrow("Primary event references are not supported in this query mode");
	});

	it("rejects primary event schema references before event-first modes are implemented", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "event-schema", path: ["slug"] },
				context,
				displayBuiltins,
			),
		).toThrow("Primary event schema references are not supported in this query mode");
	});

	it("rejects non-numeric aggregate expressions", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					filter: null,
					eventJoins: [],
					mode: "aggregate",
					computedFields: [],
					relationshipJoins: [],
					scope: ["smartphones"],
					aggregations: [
						{
							key: "sumName",
							aggregation: {
								type: "sum",
								expression: createEntityColumnExpression("smartphones", "name"),
							},
						},
					],
				},
				context,
			),
		).toThrow("sum aggregation requires a numeric expression");
	});

	it("rejects unsupported entity-schema columns even when the name overlaps entity builtins", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "entity-schema", path: ["externalId"] },
				context,
				displayBuiltins,
			),
		).toThrow("Unsupported entity schema column 'entity-schema.externalId'");
	});

	it("rejects non-numeric event-aggregate properties", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					filter: null,
					eventJoins: [],
					mode: "entities",
					computedFields: [],
					relationshipJoins: [],
					scope: ["smartphones"],
					pagination: { page: 1, limit: 10 },
					sort: {
						direction: "asc",
						expression: createEntityColumnExpression("smartphones", "name"),
					},
					fields: [
						{
							key: "avgReviewLabel",
							expression: createEventAggregateExpression("review", ["properties", "label"], "avg"),
						},
					],
				},
				{
					...context,
					eventSchemaMap: new Map([
						[
							"review",
							[
								{
									slug: "review",
									id: "review-smartphone",
									entitySchemaSlug: "smartphones",
									entitySchemaId: "smartphones-id",
									propertiesSchema: {
										fields: {
											label: { type: "string", label: "Review Label", description: "Review label" },
										},
									},
								},
							],
						],
					]),
				},
			),
		).toThrow("avg event aggregate requires a numeric property, received 'string'");
	});

	it("accepts count event-aggregate references without a path", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					filter: null,
					eventJoins: [],
					mode: "entities",
					computedFields: [],
					relationshipJoins: [],
					scope: ["smartphones"],
					pagination: { page: 1, limit: 10 },
					sort: {
						direction: "asc",
						expression: createEntityColumnExpression("smartphones", "name"),
					},
					fields: [
						{
							key: "reviewCount",
							expression: {
								type: "reference",
								reference: {
									aggregation: "count",
									type: "event-aggregate",
									eventSchemaSlug: "review",
								},
							},
						},
					],
				},
				{
					...context,
					eventSchemaMap: new Map([["review", []]]),
					eventSchemaSlugs: new Set(["review"]),
				},
			),
		).not.toThrow();
	});

	it("rejects saved view entity ids that do not resolve to string values", () => {
		expect(() =>
			validateSavedViewDisplayConfiguration(
				{
					...createDefaultDisplayConfiguration("collection"),
					entityIdProperty: { type: "literal", value: 1 },
				},
				context,
			),
		).toThrow("Saved view entityIdProperty requires a string expression");
	});

	it("accepts primary event property references when matching event schemas share a compatible definition", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{
					type: "event",
					eventSchemaSlug: "review",
					path: ["properties", "rating"],
				},
				{
					...context,
					supportsPrimaryEventRefs: true,
					eventSchemaMap: new Map([
						[
							"review",
							[
								{
									slug: "review",
									id: "review-smartphone",
									entitySchemaSlug: "smartphones",
									entitySchemaId: "smartphones-id",
									propertiesSchema: {
										fields: {
											rating: {
												type: "integer",
												label: "Phone Rating",
												description: "Phone review score",
											},
										},
									},
								},
								{
									slug: "review",
									id: "review-tablet",
									entitySchemaSlug: "tablets",
									entitySchemaId: "tablets-id",
									propertiesSchema: {
										fields: {
											rating: {
												type: "integer",
												label: "Tablet Rating",
												description: "Tablet review score",
											},
										},
									},
								},
							],
						],
					]),
				},
				displayBuiltins,
			),
		).not.toThrow();
	});

	it("rejects primary event property references without eventSchemaSlug when required by query context", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{
					type: "event",
					path: ["properties", "rating"],
				},
				{
					...context,
					supportsPrimaryEventRefs: true,
					requirePrimaryEventSchemaSlug: true,
					eventSchemaMap: new Map([
						[
							"review",
							[
								{
									slug: "review",
									id: "review-smartphone",
									entitySchemaSlug: "smartphones",
									entitySchemaId: "smartphones-id",
									propertiesSchema: {
										fields: {
											rating: {
												type: "integer",
												label: "Phone Rating",
												description: "Phone review score",
											},
										},
									},
								},
							],
						],
					]),
				},
				displayBuiltins,
			),
		).toThrow("Primary event property references in this context must specify eventSchemaSlug");
	});

	it("rejects nested entity built-in paths", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "entity", slug: "smartphones", path: ["name", "nested"] },
				context,
				displayBuiltins,
			),
		).toThrow("Entity column 'name.nested' does not support nested paths");
	});

	it("rejects nested event built-in paths", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "event", path: ["createdAt", "nested"] },
				{ ...context, eventSchemaMap: new Map(), supportsPrimaryEventRefs: true },
				displayBuiltins,
			),
		).toThrow("Event column 'createdAt.nested' does not support nested paths");
	});

	it("rejects countBy expressions that are not comparable scalars", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					filter: null,
					eventJoins: [],
					mode: "aggregate",
					computedFields: [],
					relationshipJoins: [],
					scope: ["smartphones"],
					aggregations: [
						{
							key: "byMetadata",
							aggregation: {
								type: "countBy",
								groupBy: {
									type: "reference",
									reference: {
										type: "entity",
										slug: "smartphones",
										path: ["properties", "metadata"],
									},
								},
							},
						},
					],
				},
				context,
			),
		).toThrow("Filter operator 'countBy' is not supported for expression type 'object'");
	});

	it("rejects countWhere predicates that use unsupported primary event refs", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					filter: null,
					eventJoins: [],
					mode: "aggregate",
					computedFields: [],
					relationshipJoins: [],
					scope: ["smartphones"],
					aggregations: [
						{
							key: "reviewCount",
							aggregation: {
								type: "countWhere",
								predicate: {
									operator: "eq",
									type: "comparison",
									right: { type: "literal", value: "2024-01-01T00:00:00.000Z" },
									left: { type: "reference", reference: { type: "event", path: ["createdAt"] } },
								},
							},
						},
					],
				},
				context,
			),
		).toThrow("Primary event references are not supported in this query mode");
	});

	it("rejects computed fields that hide unslugged primary event property refs in strict contexts", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					filter: {
						type: "comparison",
						operator: "eq",
						left: createComputedFieldExpression("eventRating"),
						right: { type: "literal", value: "5" },
					},
					mode: "events",
					eventJoins: [],
					computedFields: [
						{
							key: "eventRating",
							expression: {
								type: "reference",
								reference: {
									type: "event",
									path: ["properties", "rating"],
								},
							},
						},
					],
					scope: ["smartphones"],
					eventSchemas: ["review"],
					pagination: { page: 1, limit: 10 },
					sort: {
						direction: "asc",
						expression: createEntityColumnExpression("smartphones", "name"),
					},
					fields: [],
				},
				{
					...context,
					supportsPrimaryEventRefs: true,
					eventSchemaMap: new Map([
						[
							"review",
							[
								{
									slug: "review",
									id: "review-smartphone",
									entitySchemaSlug: "smartphones",
									entitySchemaId: "smartphones-id",
									propertiesSchema: {
										fields: {
											rating: {
												type: "integer",
												label: "Phone Rating",
												description: "Phone review score",
											},
										},
									},
								},
							],
						],
					]),
				},
			),
		).toThrow("Primary event property references in this context must specify eventSchemaSlug");
	});

	it("rejects unslugged primary event refs inside conditional sort predicates", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					filter: null,
					mode: "events",
					eventJoins: [],
					computedFields: [],
					scope: ["smartphones"],
					eventSchemas: ["review"],
					pagination: { page: 1, limit: 10 },
					sort: {
						direction: "asc",
						expression: {
							type: "conditional",
							condition: {
								type: "comparison",
								operator: "eq",
								left: {
									type: "reference",
									reference: {
										type: "event",
										path: ["properties", "rating"],
									},
								},
								right: { type: "literal", value: "5" },
							},
							whenTrue: { type: "literal", value: "before" },
							whenFalse: { type: "literal", value: "after" },
						},
					},
					fields: [],
				},
				{
					...context,
					supportsPrimaryEventRefs: true,
					eventSchemaMap: new Map([
						[
							"review",
							[
								{
									slug: "review",
									id: "review-smartphone",
									entitySchemaSlug: "smartphones",
									entitySchemaId: "smartphones-id",
									propertiesSchema: {
										fields: {
											rating: {
												type: "integer",
												label: "Phone Rating",
												description: "Phone review score",
											},
										},
									},
								},
							],
						],
					]),
				},
			),
		).toThrow("Primary event property references in this context must specify eventSchemaSlug");
	});

	it("rejects primary event property references when matching event schemas disagree", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{
					type: "event",
					eventSchemaSlug: "review",
					path: ["properties", "rating"],
				},
				{
					...context,
					supportsPrimaryEventRefs: true,
					eventSchemaMap: new Map([
						[
							"review",
							[
								{
									slug: "review",
									id: "review-smartphone",
									entitySchemaSlug: "smartphones",
									entitySchemaId: "smartphones-id",
									propertiesSchema: {
										fields: {
											rating: {
												type: "integer",
												label: "Phone Rating",
												description: "Phone review score",
											},
										},
									},
								},
								{
									slug: "review",
									id: "review-tablet",
									entitySchemaSlug: "tablets",
									entitySchemaId: "tablets-id",
									propertiesSchema: {
										fields: {
											rating: {
												type: "string",
												label: "Tablet Rating",
												description: "Tablet review label",
											},
										},
									},
								},
							],
						],
					]),
				},
				displayBuiltins,
			),
		).toThrow(
			"Property 'rating' has incompatible definitions across event schemas for slug 'review'",
		);
	});
});

const relationshipJoin = {
	key: "ownership",
	kind: "latestRelationship" as const,
	relationshipSchemaSlug: "ownership",
	sourceEntitySchema: {
		slug: "smartphones",
		propertiesSchema: createSmartphoneSchema().propertiesSchema,
	},
	targetEntitySchema: {
		slug: "smartphones",
		propertiesSchema: createSmartphoneSchema().propertiesSchema,
	},
	propertiesSchema: {
		fields: {
			rating: {
				label: "Rating",
				type: "integer" as const,
				description: "Owner rating",
			},
			tags: {
				label: "Tags",
				type: "array" as const,
				description: "Ownership tags",
				items: { label: "Tag", type: "string" as const, description: "A tag" },
			},
		},
	},
};

const relationshipJoinMap = buildRelationshipJoinMap([relationshipJoin]);

const minimalEntitiesRequest = {
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

const entitiesContext = {
	...context,
	relationshipJoinMap,
};

describe("relationship-join reference validation", () => {
	it("passes for a valid relationship-join built-in reference (id)", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "relationship-join", joinKey: "ownership", path: ["id"] },
				entitiesContext,
				displayBuiltins,
			),
		).not.toThrow();
	});

	it("passes for a valid relationship-join built-in reference (createdAt)", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "relationship-join", joinKey: "ownership", path: ["createdAt"] },
				entitiesContext,
				displayBuiltins,
			),
		).not.toThrow();
	});

	it("passes for a valid relationship-join built-in reference (sourceEntityId)", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "relationship-join", joinKey: "ownership", path: ["sourceEntityId"] },
				entitiesContext,
				displayBuiltins,
			),
		).not.toThrow();
	});

	it("passes for a valid relationship-join built-in reference (targetEntityId)", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "relationship-join", joinKey: "ownership", path: ["targetEntityId"] },
				entitiesContext,
				displayBuiltins,
			),
		).not.toThrow();
	});

	it("passes for a valid relationship property reference (properties.rating)", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "relationship-join", joinKey: "ownership", path: ["properties", "rating"] },
				entitiesContext,
				displayBuiltins,
			),
		).not.toThrow();
	});

	it("passes for related entity properties when the relationship side schema is defined", () => {
		for (const entitySide of ["sourceEntity", "targetEntity"] as const) {
			expect(() =>
				validateRuntimeReferenceAgainstSchemas(
					{
						type: "relationship-join",
						joinKey: "ownership",
						path: [entitySide, "properties", "nameplate"],
					},
					entitiesContext,
					displayBuiltins,
				),
			).not.toThrow();
		}
	});

	it("rejects nested event-join built-in paths", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "event-join", joinKey: "review", path: ["createdAt", "nested"] },
				{
					...context,
					eventJoinMap: new Map([
						[
							"review",
							{
								key: "review",
								eventSchemas: [],
								eventSchemaSlug: "review",
								eventSchemaMap: new Map(),
								kind: "latestEvent" as const,
							},
						],
					]),
				},
				displayBuiltins,
			),
		).toThrow("Event join column 'createdAt.nested' does not support nested paths");
	});

	it("rejects nested relationship built-in paths", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "relationship-join", joinKey: "ownership", path: ["createdAt", "nested"] },
				entitiesContext,
				displayBuiltins,
			),
		).toThrow("Relationship join column 'createdAt.nested' does not support nested paths");
	});

	it("rejects nested related entity built-in paths", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{
					joinKey: "ownership",
					type: "relationship-join",
					path: ["sourceEntity", "name", "nested"],
				},
				entitiesContext,
				displayBuiltins,
			),
		).toThrow("Related entity column 'name.nested' does not support nested paths");
	});

	it("throws for related entity properties when the relationship side schema is not defined", () => {
		const contextWithoutSourceSchema = {
			...context,
			relationshipJoinMap: buildRelationshipJoinMap([
				{
					...relationshipJoin,
					sourceEntitySchema: undefined,
				},
			]),
		};
		const contextWithoutTargetSchema = {
			...context,
			relationshipJoinMap: buildRelationshipJoinMap([
				{
					...relationshipJoin,
					targetEntitySchema: undefined,
				},
			]),
		};

		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{
					type: "relationship-join",
					joinKey: "ownership",
					path: ["sourceEntity", "properties", "nameplate"],
				},
				contextWithoutSourceSchema,
				displayBuiltins,
			),
		).toThrow(
			"Related entity properties under 'sourceEntity.properties' require the source entity schema to be defined on the relationship schema 'ownership'",
		);
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{
					type: "relationship-join",
					joinKey: "ownership",
					path: ["targetEntity", "properties", "nameplate"],
				},
				contextWithoutTargetSchema,
				displayBuiltins,
			),
		).toThrow(
			"Related entity properties under 'targetEntity.properties' require the target entity schema to be defined on the relationship schema 'ownership'",
		);
	});

	it("throws when the join key is not in the relationshipJoinMap", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "relationship-join", joinKey: "unknown", path: ["createdAt"] },
				entitiesContext,
				displayBuiltins,
			),
		).toThrow("Relationship join 'relationship.unknown' is not part of this runtime request");
	});

	it("throws for an unsupported built-in column", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "relationship-join", joinKey: "ownership", path: ["badColumn"] },
				entitiesContext,
				displayBuiltins,
			),
		).toThrow("Unsupported relationship join column 'relationship.ownership.badColumn'");
	});

	it("throws for a property path that does not exist in the relationship schema", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "relationship-join", joinKey: "ownership", path: ["properties", "nonexistent"] },
				entitiesContext,
				displayBuiltins,
			),
		).toThrow("not found in relationship schema");
	});

	it("throws when a relationship-join reference appears in events mode", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					filter: null,
					mode: "events",
					eventJoins: [],
					computedFields: [],
					scope: ["smartphones"],
					eventSchemas: ["review"],
					pagination: { page: 1, limit: 10 },
					sort: {
						direction: "asc",
						expression: createEntityColumnExpression("smartphones", "name"),
					},
					fields: [
						{
							key: "joinCreatedAt",
							expression: {
								type: "reference",
								reference: { path: ["createdAt"], joinKey: "ownership", type: "relationship-join" },
							},
						},
					],
				},
				{ ...entitiesContext, supportsPrimaryEventRefs: true },
			),
		).toThrow("Relationship join references are not supported in this query mode");
	});

	it("throws when a relationship-join reference appears in timeSeries mode", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					filter: {
						operator: "eq",
						type: "comparison",
						right: literalExpression("2024-01-01T00:00:00.000Z"),
						left: {
							type: "reference",
							reference: { path: ["createdAt"], joinKey: "ownership", type: "relationship-join" },
						},
					},
					bucket: "day",
					mode: "timeSeries",
					computedFields: [],
					scope: ["smartphones"],
					eventSchemas: ["review"],
					metric: { type: "count" },
					dateRange: { endAt: "2024-12-31T00:00:00.000Z", startAt: "2024-01-01T00:00:00.000Z" },
				},
				{ ...entitiesContext, supportsPrimaryEventRefs: true },
			),
		).toThrow("Relationship join references are not supported in this query mode");
	});
});

describe("join-local filter validation", () => {
	it("passes when the filter is a comparison between a relationship property and a literal", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					...minimalEntitiesRequest,
					relationshipJoins: [
						{
							required: false,
							key: "ownership",
							direction: "outgoing" as const,
							kind: "latestRelationship" as const,
							relationshipSchemaSlug: "ownership",
							filter: comparisonPredicate(
								{
									type: "reference",
									reference: {
										joinKey: "ownership",
										type: "relationship-join",
										path: ["properties", "rating"],
									},
								},
								"gte",
								literalExpression(3),
							),
						},
					],
				},
				entitiesContext,
			),
		).not.toThrow();
	});

	it("throws when a relationship integer property is compared with a string literal", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					...minimalEntitiesRequest,
					relationshipJoins: [
						{
							required: false,
							key: "ownership",
							direction: "outgoing" as const,
							kind: "latestRelationship" as const,
							relationshipSchemaSlug: "ownership",
							filter: comparisonPredicate(
								{
									type: "reference",
									reference: {
										joinKey: "ownership",
										type: "relationship-join",
										path: ["properties", "rating"],
									},
								},
								"gte",
								literalExpression("3"),
							),
						},
					],
				},
				entitiesContext,
			),
		).toThrow(
			"Filter operator 'gte' requires compatible expression types, received 'integer' and 'string'",
		);
	});

	it("passes when the filter uses contains on an array property", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					...minimalEntitiesRequest,
					relationshipJoins: [
						{
							key: "ownership",
							required: false,
							direction: "outgoing" as const,
							kind: "latestRelationship" as const,
							relationshipSchemaSlug: "ownership",
							filter: {
								type: "contains",
								value: literalExpression("featured"),
								expression: {
									type: "reference",
									reference: {
										joinKey: "ownership",
										type: "relationship-join",
										path: ["properties", "tags"],
									},
								},
							},
						},
					],
				},
				entitiesContext,
			),
		).not.toThrow();
	});

	it("throws when contains receives a literal incompatible with relationship array items", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					...minimalEntitiesRequest,
					relationshipJoins: [
						{
							key: "ownership",
							required: false,
							direction: "outgoing" as const,
							kind: "latestRelationship" as const,
							relationshipSchemaSlug: "ownership",
							filter: {
								type: "contains",
								value: literalExpression(123),
								expression: {
									type: "reference",
									reference: {
										joinKey: "ownership",
										type: "relationship-join",
										path: ["properties", "tags"],
									},
								},
							},
						},
					],
				},
				entitiesContext,
			),
		).toThrow(
			"Filter operator 'contains' received a literal value incompatible with the array item schema",
		);
	});

	it("throws when the filter references a computed-field", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					...minimalEntitiesRequest,
					relationshipJoins: [
						{
							key: "ownership",
							required: false,
							direction: "outgoing" as const,
							kind: "latestRelationship" as const,
							relationshipSchemaSlug: "ownership",
							filter: comparisonPredicate(
								{ type: "reference", reference: { type: "computed-field", key: "someField" } },
								"eq",
								literalExpression(1),
							),
						},
					],
				},
				entitiesContext,
			),
		).toThrow("Join-local filter may only reference the current relationship join");
	});

	it("throws when the filter references an entity reference", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					...minimalEntitiesRequest,
					relationshipJoins: [
						{
							required: false,
							key: "ownership",
							direction: "outgoing" as const,
							kind: "latestRelationship" as const,
							relationshipSchemaSlug: "ownership",
							filter: comparisonPredicate(
								{
									type: "reference",
									reference: {
										type: "entity",
										slug: "smartphones",
										path: ["properties", "manufacturer"],
									},
								},
								"eq",
								literalExpression("Apple"),
							),
						},
					],
				},
				entitiesContext,
			),
		).toThrow("Join-local filter may only reference the current relationship join");
	});

	it("throws when the filter references an event-join reference", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					...minimalEntitiesRequest,
					relationshipJoins: [
						{
							required: false,
							key: "ownership",
							direction: "outgoing" as const,
							relationshipSchemaSlug: "ownership",
							kind: "latestRelationship" as const,
							filter: comparisonPredicate(
								{
									type: "reference",
									reference: {
										type: "event-join",
										joinKey: "review",
										path: ["properties", "rating"],
									},
								},
								"gte",
								literalExpression(4),
							),
						},
					],
				},
				entitiesContext,
			),
		).toThrow("Join-local filter may only reference the current relationship join");
	});

	it("throws when the filter references a different relationship join key", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					...minimalEntitiesRequest,
					relationshipJoins: [
						{
							required: false,
							key: "ownership",
							direction: "outgoing" as const,
							kind: "latestRelationship" as const,
							relationshipSchemaSlug: "ownership",
							filter: comparisonPredicate(
								{
									type: "reference",
									reference: {
										joinKey: "otherJoin",
										type: "relationship-join",
										path: ["properties", "rating"],
									},
								},
								"gte",
								literalExpression(3),
							),
						},
					],
				},
				entitiesContext,
			),
		).toThrow("Join-local filter cannot reference relationship join 'otherJoin'");
	});

	it("throws when the filter references sourceEntity path", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					...minimalEntitiesRequest,
					relationshipJoins: [
						{
							required: false,
							key: "ownership",
							direction: "outgoing" as const,
							kind: "latestRelationship" as const,
							relationshipSchemaSlug: "ownership",
							filter: comparisonPredicate(
								{
									type: "reference",
									reference: {
										joinKey: "ownership",
										type: "relationship-join",
										path: ["sourceEntity", "name"],
									},
								},
								"eq",
								literalExpression("phone"),
							),
						},
					],
				},
				entitiesContext,
			),
		).toThrow("Join-local filter cannot reference related entity data 'sourceEntity'");
	});

	it("throws when the filter references targetEntity path", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					...minimalEntitiesRequest,
					relationshipJoins: [
						{
							required: false,
							key: "ownership",
							direction: "outgoing" as const,
							kind: "latestRelationship" as const,
							relationshipSchemaSlug: "ownership",
							filter: comparisonPredicate(
								{
									type: "reference",
									reference: {
										joinKey: "ownership",
										type: "relationship-join",
										path: ["targetEntity", "name"],
									},
								},
								"eq",
								literalExpression("phone"),
							),
						},
					],
				},
				entitiesContext,
			),
		).toThrow("Join-local filter cannot reference related entity data 'targetEntity'");
	});
});
