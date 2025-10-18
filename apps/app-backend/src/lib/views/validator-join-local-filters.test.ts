import { describe, expect, it } from "vitest";

import { createComputedFieldExpression, type QueryRelationshipJoin } from "#lib/query-language";

import { comparison, entitiesContext, literal, minimalEntitiesRequest } from "./test-support";
import { validateQueryEngineReferences } from "./validator";

const createOwnershipJoin = (filter: QueryRelationshipJoin["filter"]): QueryRelationshipJoin => ({
	filter,
	required: false,
	key: "ownership",
	direction: "outgoing",
	kind: "latestRelationship",
	relationshipSchemaSlug: "ownership",
});

describe("join-local filter validation", () => {
	it("passes when the filter is a comparison between a relationship property and a literal", () => {
		expect(() =>
			validateQueryEngineReferences(
				{
					...minimalEntitiesRequest,
					relationshipJoins: [
						createOwnershipJoin(
							comparison(
								{
									type: "reference",
									reference: {
										joinKey: "ownership",
										type: "relationship-join",
										path: ["properties", "rating"],
									},
								},
								"gte",
								literal(3),
							),
						),
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
						createOwnershipJoin(
							comparison(
								{
									type: "reference",
									reference: {
										joinKey: "ownership",
										type: "relationship-join",
										path: ["properties", "rating"],
									},
								},
								"gte",
								literal("3"),
							),
						),
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
						createOwnershipJoin({
							type: "contains",
							value: literal("featured"),
							expression: {
								type: "reference",
								reference: {
									joinKey: "ownership",
									type: "relationship-join",
									path: ["properties", "tags"],
								},
							},
						}),
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
						createOwnershipJoin({
							type: "contains",
							value: literal(123),
							expression: {
								type: "reference",
								reference: {
									joinKey: "ownership",
									type: "relationship-join",
									path: ["properties", "tags"],
								},
							},
						}),
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
						createOwnershipJoin(
							comparison(createComputedFieldExpression("someField"), "eq", literal(1)),
						),
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
						createOwnershipJoin(
							comparison(
								{
									type: "reference",
									reference: {
										type: "entity",
										slug: "smartphones",
										path: ["properties", "manufacturer"],
									},
								},
								"eq",
								literal("Apple"),
							),
						),
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
						createOwnershipJoin(
							comparison(
								{
									type: "reference",
									reference: {
										joinKey: "review",
										type: "event-join",
										path: ["properties", "rating"],
									},
								},
								"gte",
								literal(4),
							),
						),
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
						createOwnershipJoin(
							comparison(
								{
									type: "reference",
									reference: {
										joinKey: "otherJoin",
										type: "relationship-join",
										path: ["properties", "rating"],
									},
								},
								"gte",
								literal(3),
							),
						),
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
						createOwnershipJoin(
							comparison(
								{
									type: "reference",
									reference: {
										joinKey: "ownership",
										type: "relationship-join",
										path: ["sourceEntity", "name"],
									},
								},
								"eq",
								literal("phone"),
							),
						),
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
						createOwnershipJoin(
							comparison(
								{
									type: "reference",
									reference: {
										joinKey: "ownership",
										type: "relationship-join",
										path: ["targetEntity", "name"],
									},
								},
								"eq",
								literal("phone"),
							),
						),
					],
				},
				entitiesContext,
			),
		).toThrow("Join-local filter cannot reference related entity data 'targetEntity'");
	});
});
