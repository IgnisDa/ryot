import { describe, expect, it } from "vitest";

import { createEntityColumnExpression, createLiteralExpression } from "#lib/query-language";

import { buildEventJoinMap, buildRelationshipJoinMap, displayBuiltins } from "./reference";
import {
	comparison,
	context,
	createEventJoin,
	entitiesContext,
	relationshipJoin,
} from "./test-support";
import { validateQueryEngineReferences, validateRuntimeReferenceAgainstSchemas } from "./validator";

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
						joinKey: "ownership",
						type: "relationship-join",
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
					eventJoinMap: buildEventJoinMap([createEventJoin([])]),
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
				{ ...relationshipJoin, sourceEntitySchema: undefined },
			]),
		};
		const contextWithoutTargetSchema = {
			...context,
			relationshipJoinMap: buildRelationshipJoinMap([
				{ ...relationshipJoin, targetEntitySchema: undefined },
			]),
		};

		expect(() =>
			validateRuntimeReferenceAgainstSchemas(
				{
					joinKey: "ownership",
					type: "relationship-join",
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
					joinKey: "ownership",
					type: "relationship-join",
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
								reference: {
									path: ["createdAt"],
									joinKey: "ownership",
									type: "relationship-join",
								},
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
					bucket: "day",
					mode: "timeSeries",
					computedFields: [],
					scope: ["smartphones"],
					eventSchemas: ["review"],
					metric: { type: "count" },
					dateRange: { endAt: "2024-12-31T00:00:00.000Z", startAt: "2024-01-01T00:00:00.000Z" },
					filter: comparison(
						{
							type: "reference",
							reference: { path: ["createdAt"], joinKey: "ownership", type: "relationship-join" },
						},
						"eq",
						createLiteralExpression("2024-01-01T00:00:00.000Z"),
					),
				},
				{ ...entitiesContext, supportsPrimaryEventRefs: true },
			),
		).toThrow("Relationship join references are not supported in this query mode");
	});
});
