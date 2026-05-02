import { describe, expect, it } from "bun:test";
import {
	createEntityColumnExpression,
	createEventAggregateExpression,
} from "@ryot/ts-utils";
import { createSmartphoneSchema } from "~/lib/test-fixtures";
import { buildSchemaMap, displayBuiltins } from "./reference";
import {
	validateQueryEngineReferences,
	validateRuntimeReferenceAgainstSchemas,
} from "./validator";

const context = {
	eventJoinMap: new Map(),
	schemaMap: buildSchemaMap([createSmartphoneSchema()]),
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
		).toThrow(
			"Primary event schema references are not supported in this query mode",
		);
	});

	it("rejects non-numeric aggregate expressions", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					filter: null,
					eventJoins: [],
					mode: "aggregate",
					relationships: [],
					computedFields: [],
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
					fields: [
						{
							key: "avgReviewLabel",
							expression: createEventAggregateExpression(
								"review",
								["properties", "label"],
								"avg",
							),
						},
					],
					filter: null,
					eventJoins: [],
					mode: "entities",
					relationships: [],
					computedFields: [],
					scope: ["smartphones"],
					sort: {
						direction: "asc",
						expression: createEntityColumnExpression("smartphones", "name"),
					},
					pagination: { page: 1, limit: 10 },
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
											label: {
												type: "string",
												label: "Review Label",
												description: "Review label",
											},
										},
									},
								},
							],
						],
					]),
				},
			),
		).toThrow(
			"avg event aggregate requires a numeric property, received 'string'",
		);
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
