import { describe, expect, it } from "vitest";

import { buildDisplayConfig } from "#lib/builtins/view-helpers";
import {
	createComputedFieldExpression,
	createEntityColumnExpression,
	createEventAggregateExpression,
	createLiteralExpression,
} from "#lib/query-language";
import type { AppSchema } from "#lib/schema";

import { displayBuiltins } from "./reference";
import { context, createEventSchema } from "./test-support";
import {
	validateQueryEngineReferences,
	validateRuntimeReferenceAgainstSchemas,
	validateSavedViewDisplayConfiguration,
} from "./validator";

const integerRatingPropertiesSchema = {
	fields: { rating: { label: "Rating", type: "integer", description: "Review score" } },
} satisfies AppSchema;

const stringRatingPropertiesSchema = {
	fields: { rating: { type: "string", label: "Rating", description: "Review label" } },
} satisfies AppSchema;

const labelPropertiesSchema = {
	fields: { label: { type: "string", label: "Review Label", description: "Review label" } },
} satisfies AppSchema;

describe("validateRuntimeReferenceAgainstSchemas", () => {
	it("rejects primary event references before event-first modes are implemented", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "event", eventSchemaSlug: "review", path: ["properties", "rating"] },
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
							expression: createEventAggregateExpression("review", "avg", ["properties", "label"]),
						},
					],
				},
				{
					...context,
					eventSchemaMap: new Map([
						[
							"review",
							[
								createEventSchema({
									id: "review-smartphone",
									entitySchemaSlug: "smartphones",
									entitySchemaId: "smartphones-id",
									propertiesSchema: labelPropertiesSchema,
								}),
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
					...buildDisplayConfig("collection"),
					entityIdProperty: { type: "literal", value: 1 },
				},
				context,
			),
		).toThrow("Saved view entityIdProperty requires a string expression");
	});

	it("accepts primary event property references when matching event schemas share a compatible definition", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "event", eventSchemaSlug: "review", path: ["properties", "rating"] },
				{
					...context,
					supportsPrimaryEventRefs: true,
					eventSchemaMap: new Map([
						[
							"review",
							[
								createEventSchema({
									id: "review-smartphone",
									entitySchemaSlug: "smartphones",
									entitySchemaId: "smartphones-id",
									propertiesSchema: integerRatingPropertiesSchema,
								}),
								createEventSchema({
									id: "review-tablet",
									entitySchemaSlug: "tablets",
									entitySchemaId: "tablets-id",
									propertiesSchema: integerRatingPropertiesSchema,
								}),
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
						["review", [createEventSchema({ propertiesSchema: integerRatingPropertiesSchema })]],
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
									right: createLiteralExpression("2024-01-01T00:00:00.000Z"),
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
					fields: [],
					eventJoins: [],
					mode: "events",
					scope: ["smartphones"],
					eventSchemas: ["review"],
					pagination: { page: 1, limit: 10 },
					sort: {
						direction: "asc",
						expression: createEntityColumnExpression("smartphones", "name"),
					},
					filter: {
						operator: "eq",
						type: "comparison",
						right: { type: "literal", value: "5" },
						left: createComputedFieldExpression("eventRating"),
					},
					computedFields: [
						{
							key: "eventRating",
							expression: {
								type: "reference",
								reference: { type: "event", path: ["properties", "rating"] },
							},
						},
					],
				},
				{
					...context,
					supportsPrimaryEventRefs: true,
					eventSchemaMap: new Map([
						["review", [createEventSchema({ propertiesSchema: integerRatingPropertiesSchema })]],
					]),
				},
			),
		).toThrow("Primary event property references in this context must specify eventSchemaSlug");
	});

	it("rejects unslugged primary event refs inside conditional sort predicates", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					fields: [],
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
							whenTrue: { type: "literal", value: "before" },
							whenFalse: { type: "literal", value: "after" },
							condition: {
								operator: "eq",
								type: "comparison",
								right: { type: "literal", value: "5" },
								left: {
									type: "reference",
									reference: { type: "event", path: ["properties", "rating"] },
								},
							},
						},
					},
				},
				{
					...context,
					supportsPrimaryEventRefs: true,
					eventSchemaMap: new Map([
						["review", [createEventSchema({ propertiesSchema: integerRatingPropertiesSchema })]],
					]),
				},
			),
		).toThrow("Primary event property references in this context must specify eventSchemaSlug");
	});

	it("rejects primary event property references when matching event schemas disagree", () => {
		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{ type: "event", eventSchemaSlug: "review", path: ["properties", "rating"] },
				{
					...context,
					supportsPrimaryEventRefs: true,
					eventSchemaMap: new Map([
						[
							"review",
							[
								createEventSchema({
									id: "review-smartphone",
									entitySchemaSlug: "smartphones",
									entitySchemaId: "smartphones-id",
									propertiesSchema: integerRatingPropertiesSchema,
								}),
								createEventSchema({
									id: "review-tablet",
									entitySchemaSlug: "tablets",
									entitySchemaId: "tablets-id",
									propertiesSchema: stringRatingPropertiesSchema,
								}),
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
