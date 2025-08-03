import { describe, expect, it } from "bun:test";

import {
	createEntityPropertyExpression,
	createEntitySchemaExpression,
} from "@ryot/ts-utils/view-language";

import { createSmartphoneSchema, createTabletSchema, literalExpression } from "~/lib/test-fixtures";
import type { ViewComputedField, ViewExpression } from "~/lib/views/expression";
import { buildEventJoinMap, buildRelationshipJoinMap, buildSchemaMap } from "~/lib/views/reference";

import type { QueryEngineContext } from "./schemas";
import { buildSortExpression } from "./sort-builder";
import { createQueryTestCompiler, dialect } from "./test-support";

const tabletSchema = createTabletSchema();
const smartphoneSchema = createSmartphoneSchema();
const schemaMap = buildSchemaMap([smartphoneSchema, tabletSchema]);
const context: QueryEngineContext = {
	schemaMap,
	eventJoinMap: buildEventJoinMap([]),
};

const ownershipJoin = {
	key: "ownership",
	kind: "latestRelationship" as const,
	relationshipSchemaSlug: "ownership",
	sourceEntitySchema: { slug: "smartphones", propertiesSchema: smartphoneSchema.propertiesSchema },
	targetEntitySchema: { slug: "smartphones", propertiesSchema: smartphoneSchema.propertiesSchema },
	propertiesSchema: {
		fields: { rating: { label: "Rating", type: "integer" as const, description: "Owner rating" } },
	},
};

const contextWithRelJoin: QueryEngineContext = {
	...context,
	relationshipJoinMap: buildRelationshipJoinMap([ownershipJoin]),
};

type SortTestInput = {
	alias: string;
	expression: ViewExpression;
	context: QueryEngineContext;
	computedFields?: ViewComputedField[];
};

const buildSort = (input: SortTestInput) => {
	const compiler = createQueryTestCompiler(input);
	return buildSortExpression({
		compiler,
		context: input.context,
		expression: input.expression,
		computedFields: input.computedFields,
	});
};

describe("buildSortExpression", () => {
	it("compiles an entity property sort expression", () => {
		const sortExpr = buildSort({
			context,
			alias: "entities",
			computedFields: [],
			expression: createEntityPropertyExpression("smartphones", "releaseYear"),
		});

		const query = dialect.sqlToQuery(sortExpr);
		expect(query.sql).toContain("entities.properties ->>");
		expect(query.params).toContain("releaseYear");
		expect(query.sql).toContain("::integer");
	});

	it("compiles a string property sort expression", () => {
		const sortExpr = buildSort({
			context,
			alias: "entities",
			computedFields: [],
			expression: createEntityPropertyExpression("smartphones", "nameplate"),
		});

		const query = dialect.sqlToQuery(sortExpr);
		expect(query.sql).toContain("entities.properties ->>");
		expect(query.params).toContain("nameplate");
		expect(query.sql).not.toContain("::integer");
	});

	it("compiles an entity schema sort expression", () => {
		const sortExpr = buildSort({
			context,
			alias: "entities",
			computedFields: [],
			expression: createEntitySchemaExpression("name"),
		});

		const query = dialect.sqlToQuery(sortExpr);
		expect(query.sql).toContain("entity_schema_data ->>");
		expect(query.params).toContain("name");
	});

	it("compiles a sort expression with a computed field", () => {
		const sortExpr = buildSort({
			context,
			alias: "entities",
			expression: {
				type: "reference",
				reference: { type: "computed-field", key: "nextYear" },
			},
			computedFields: [
				{
					key: "nextYear",
					expression: {
						operator: "add",
						type: "arithmetic",
						right: literalExpression(1),
						left: createEntityPropertyExpression("smartphones", "releaseYear"),
					},
				},
			],
		});

		const query = dialect.sqlToQuery(sortExpr);
		expect(query.sql.toLowerCase()).toContain("case when");
		expect(query.params).toContain("releaseYear");
	});

	it("rejects image expressions in sort", () => {
		expect(() =>
			buildSort({
				context,
				alias: "entities",
				computedFields: [],
				expression: {
					type: "reference",
					reference: { type: "entity", path: ["image"], slug: "smartphones" },
				},
			}),
		).toThrow("display-only");
	});

	it("uses multi-schema CASE WHEN wrapping for entity property with multiple schemas", () => {
		const sortExpr = buildSort({
			context,
			alias: "entities",
			computedFields: [],
			expression: createEntityPropertyExpression("smartphones", "nameplate"),
		});

		const query = dialect.sqlToQuery(sortExpr);
		expect(query.sql.toLowerCase()).toContain("case when");
		expect(query.sql).toContain("entity_schema_data");
	});

	it("does not use CASE WHEN for single-schema context", () => {
		const singleSchemaContext: QueryEngineContext = {
			eventJoinMap: buildEventJoinMap([]),
			schemaMap: buildSchemaMap([smartphoneSchema]),
		};
		const sortExpr = buildSort({
			alias: "entities",
			computedFields: [],
			context: singleSchemaContext,
			expression: createEntityPropertyExpression("smartphones", "nameplate"),
		});

		const query = dialect.sqlToQuery(sortExpr);
		expect(query.sql.toLowerCase()).not.toContain("case when");
	});

	it("sorts by relationship built-in (createdAt)", () => {
		const sortExpr = buildSort({
			alias: "entities",
			computedFields: [],
			context: contextWithRelJoin,
			expression: {
				type: "reference",
				reference: { path: ["createdAt"], joinKey: "ownership", type: "relationship-join" },
			},
		});

		const query = dialect.sqlToQuery(sortExpr);
		expect(query.sql).toContain("entities.relationship_join_ownership");
		expect(query.params).toContain("createdAt");
	});

	it("sorts by relationship scalar property", () => {
		const sortExpr = buildSort({
			alias: "entities",
			computedFields: [],
			context: contextWithRelJoin,
			expression: {
				type: "reference",
				reference: {
					joinKey: "ownership",
					type: "relationship-join",
					path: ["properties", "rating"],
				},
			},
		});

		const query = dialect.sqlToQuery(sortExpr);
		expect(query.sql).toContain("entities.relationship_join_ownership");
		expect(query.params).toContain("rating");
		expect(query.sql).toContain("::integer");
	});

	it("throws when sorting by sourceEntity.image (display-only)", () => {
		expect(() =>
			buildSort({
				alias: "entities",
				computedFields: [],
				context: contextWithRelJoin,
				expression: {
					type: "reference",
					reference: {
						joinKey: "ownership",
						type: "relationship-join",
						path: ["sourceEntity", "image"],
					},
				},
			}),
		).toThrow("display-only");
	});
});
