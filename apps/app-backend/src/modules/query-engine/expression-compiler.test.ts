import { describe, expect, it } from "bun:test";
import {
	createComputedFieldExpression,
	createEntityPropertyExpression,
	createEntitySchemaExpression,
} from "@ryot/ts-utils";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	createSmartphoneSchema,
	transformExpression,
} from "~/lib/test-fixtures";
import type { ViewExpression } from "~/lib/views/expression";
import { buildEventJoinMap, buildSchemaMap } from "~/lib/views/reference";
import { createScalarExpressionCompiler } from "./expression-compiler";
import { createExpressionTypeResolver } from "./expression-type-resolver";

const dialect = new PgDialect();
const context = {
	eventJoinMap: buildEventJoinMap([]),
	schemaMap: buildSchemaMap([createSmartphoneSchema()]),
};

const createTestCompiler = (
	input: Omit<
		Parameters<typeof createScalarExpressionCompiler>[0],
		"getTypeInfo"
	>,
) => {
	const getTypeInfo = createExpressionTypeResolver({
		context: input.context,
		computedFields: input.computedFields,
	});
	return createScalarExpressionCompiler({ ...input, getTypeInfo });
};

const yearExpression = createEntityPropertyExpression(
	"smartphones",
	"releaseYear",
);

describe("createScalarExpressionCompiler", () => {
	it("compiles nested computed fields for scalar query stages", () => {
		const compiler = createTestCompiler({
			alias: "entities",
			context,
			computedFields: [
				{
					key: "nextYear",
					expression: {
						operator: "add",
						type: "arithmetic",
						left: yearExpression,
						right: { type: "literal", value: 1 },
					},
				},
				{
					key: "label",
					expression: {
						type: "concat",
						values: [
							{ type: "literal", value: "Release " },
							createComputedFieldExpression("nextYear"),
						],
					},
				},
			],
		});

		const query = dialect.sqlToQuery(
			compiler.compile(createComputedFieldExpression("label")),
		);

		expect(query.sql.toLowerCase()).toContain("concat(");
		expect(query.sql).toContain("entities.properties ->>");
	});

	it("reuses cached computed field expressions for the same target type", () => {
		const compiler = createTestCompiler({
			alias: "entities",
			context,
			computedFields: [
				{
					key: "nextYear",
					expression: {
						operator: "add",
						type: "arithmetic",
						left: yearExpression,
						right: { type: "literal", value: 1 },
					},
				},
			],
		});

		const first = compiler.compile(
			createComputedFieldExpression("nextYear"),
			"integer",
		);
		const second = compiler.compile(
			createComputedFieldExpression("nextYear"),
			"integer",
		);
		const third = compiler.compile(
			createComputedFieldExpression("nextYear"),
			"number",
		);

		expect(first).toBe(second);
		expect(first).not.toBe(third);
	});

	it("compiles a nested entity property path using chained JSON traversal operators", () => {
		const compiler = createTestCompiler({ context, alias: "entities" });

		const nestedRef: ViewExpression = {
			type: "reference",
			reference: {
				type: "entity",
				slug: "smartphones",
				path: ["properties", "metadata", "source"],
			},
		};

		const query = dialect.sqlToQuery(compiler.compile(nestedRef));

		expect(query.sql).toContain("entities.properties ->");
		expect(query.sql).toContain("->>");
		expect(query.params.indexOf("metadata")).toBeLessThan(
			query.params.indexOf("source"),
		);
	});

	it("rejects image computed fields in scalar sort and filter contexts", () => {
		const compiler = createTestCompiler({
			context,
			alias: "entities",
			computedFields: [
				{
					key: "cover",
					expression: {
						type: "reference",
						reference: {
							type: "entity",
							path: ["image"],
							slug: "smartphones",
						},
					},
				},
			],
		});

		expect(() =>
			compiler.compile(createComputedFieldExpression("cover"), "string"),
		).toThrow(
			"Image expressions are display-only and cannot be compiled for sort or filter usage",
		);
	});

	describe("event references", () => {
		it("compiles event.id as direct column access", () => {
			const compiler = createTestCompiler({ context, alias: "events" });

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: { type: "event", path: ["id"] },
				}),
			);

			expect(query.sql).toContain("events.id");
		});

		it("compiles event.createdAt with timestamptz cast", () => {
			const compiler = createTestCompiler({ context, alias: "events" });

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: { type: "event", path: ["createdAt"] },
				}),
			);

			expect(query.sql).toContain("events.created_at");
			expect(query.sql).toContain("::timestamptz");
		});

		it("compiles event property path as JSONB access", () => {
			const compiler = createTestCompiler({ context, alias: "events" });

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: { type: "event", path: ["properties", "rating"] },
				}),
			);

			expect(query.sql).toContain("events.properties");
			expect(query.params).toContain("rating");
		});

		it("wraps property access in CASE WHEN when eventSchemaSlug is provided", () => {
			const compiler = createTestCompiler({ context, alias: "events" });

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: {
						type: "event",
						eventSchemaSlug: "review",
						path: ["properties", "rating"],
					},
				}),
			);

			expect(query.sql.toLowerCase()).toContain("case when");
			expect(query.sql).toContain("event_schema_data ->>");
			expect(query.params).toContain("review");
			expect(query.params).toContain("rating");
		});

		it("rejects unsupported event built-in columns", () => {
			const compiler = createTestCompiler({ context, alias: "events" });

			expect(() =>
				compiler.compile({
					type: "reference",
					reference: { type: "event", path: ["unknownColumn"] },
				}),
			).toThrow("Unsupported event column");
		});
	});

	describe("event-schema references", () => {
		it("compiles event-schema.slug as JSONB text extraction", () => {
			const compiler = createTestCompiler({ context, alias: "events" });

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: { type: "event-schema", path: ["slug"] },
				}),
			);

			expect(query.sql).toContain("event_schema_data ->>");
			expect(query.params).toContain("slug");
		});

		it("compiles event-schema.name as JSONB text extraction", () => {
			const compiler = createTestCompiler({ context, alias: "events" });

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: { type: "event-schema", path: ["name"] },
				}),
			);

			expect(query.sql).toContain("event_schema_data ->>");
			expect(query.params).toContain("name");
		});

		it("compiles event-schema.isBuiltin with boolean cast", () => {
			const compiler = createTestCompiler({ context, alias: "events" });

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: { type: "event-schema", path: ["isBuiltin"] },
				}),
			);

			expect(query.sql).toContain("event_schema_data ->>");
			expect(query.sql).toContain("::boolean");
			expect(query.params).toContain("isBuiltin");
		});

		it("compiles event-schema.createdAt with timestamptz cast", () => {
			const compiler = createTestCompiler({ context, alias: "events" });

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: { type: "event-schema", path: ["createdAt"] },
				}),
			);

			expect(query.sql).toContain("event_schema_data ->>");
			expect(query.sql).toContain("::timestamptz");
			expect(query.params).toContain("createdAt");
		});

		it("rejects unsupported event-schema columns", () => {
			const compiler = createTestCompiler({ context, alias: "events" });

			expect(() =>
				compiler.compile({
					type: "reference",
					reference: { type: "event-schema", path: ["propertiesSchema"] },
				}),
			).toThrow("Unsupported event schema column");
		});

		it("rejects nested paths", () => {
			const compiler = createTestCompiler({ context, alias: "events" });

			expect(() =>
				compiler.compile({
					type: "reference",
					reference: { type: "event-schema", path: ["slug", "nested"] },
				}),
			).toThrow("do not support nested paths");
		});
	});

	describe("entity column overrides in events mode", () => {
		it("reads entity properties from entity_properties column when override is set", () => {
			const eventsContext = {
				...context,
				entityColumnOverrides: {
					id: "entity_id",
					properties: "entity_properties",
					created_at: "entity_created_at",
					updated_at: "entity_updated_at",
				},
			};
			const compiler = createTestCompiler({
				alias: "events",
				context: eventsContext,
			});

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: {
						type: "entity",
						slug: "smartphones",
						path: ["properties", "releaseYear"],
					},
				}),
			);

			expect(query.sql).toContain("events.entity_properties");
			expect(query.sql).not.toContain("events.properties");
		});

		it("reads entity id from entity_id column when override is set", () => {
			const eventsContext = {
				...context,
				entityColumnOverrides: {
					id: "entity_id",
					properties: "entity_properties",
					created_at: "entity_created_at",
					updated_at: "entity_updated_at",
				},
			};
			const compiler = createTestCompiler({
				alias: "events",
				context: eventsContext,
			});

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: { path: ["id"], type: "entity", slug: "smartphones" },
				}),
			);

			expect(query.sql).toContain("events.entity_id");
			expect(query.sql).not.toContain("events.id");
		});
	});

	describe("transform expressions", () => {
		it("compiles titleCase transform using initcap with separator normalization", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });

			const query = dialect.sqlToQuery(
				compiler.compile(
					transformExpression(
						"titleCase",
						createEntityPropertyExpression("smartphones", "nameplate"),
					),
				),
			);

			expect(query.sql).toContain("initcap(");
			expect(query.sql).toContain("replace(");
			expect(query.sql).toContain("'_'");
			expect(query.sql).toContain("' '");
		});

		it("compiles kebabCase transform using lower with separator normalization", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });

			const query = dialect.sqlToQuery(
				compiler.compile(
					transformExpression(
						"kebabCase",
						createEntityPropertyExpression("smartphones", "nameplate"),
					),
				),
			);

			expect(query.sql).toContain("lower(");
			expect(query.sql).toContain("replace(");
			expect(query.sql).toContain("'-'");
		});

		it("rejects image expressions inside transforms", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });

			const imageTransform: ViewExpression = {
				type: "transform",
				name: "titleCase",
				expression: {
					type: "reference",
					reference: { type: "entity", path: ["image"], slug: "smartphones" },
				},
			};

			expect(() => compiler.compile(imageTransform)).toThrow(
				"Image expressions are display-only",
			);
		});
	});

	describe("entity-schema expressions", () => {
		it("compiles entity schema slug as a text extraction", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });

			const query = dialect.sqlToQuery(
				compiler.compile(createEntitySchemaExpression("slug")),
			);

			expect(query.sql).toContain("entity_schema_data ->>");
			expect(query.params).toContain("slug");
		});

		it("compiles entity schema name as a text extraction", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });

			const query = dialect.sqlToQuery(
				compiler.compile(createEntitySchemaExpression("name")),
			);

			expect(query.sql).toContain("entity_schema_data ->>");
			expect(query.params).toContain("name");
		});

		it("compiles entity schema isBuiltin with boolean cast", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });

			const query = dialect.sqlToQuery(
				compiler.compile(createEntitySchemaExpression("isBuiltin")),
			);

			expect(query.sql).toContain("entity_schema_data ->>");
			expect(query.sql).toContain("::boolean");
			expect(query.params).toContain("isBuiltin");
		});

		it("compiles entity schema createdAt with timestamptz cast", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });

			const query = dialect.sqlToQuery(
				compiler.compile(createEntitySchemaExpression("createdAt")),
			);

			expect(query.sql).toContain("entity_schema_data ->>");
			expect(query.sql).toContain("::timestamptz");
			expect(query.params).toContain("createdAt");
		});

		it("compiles entity schema updatedAt with timestamptz cast", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });

			const query = dialect.sqlToQuery(
				compiler.compile(createEntitySchemaExpression("updatedAt")),
			);

			expect(query.sql).toContain("entity_schema_data ->>");
			expect(query.sql).toContain("::timestamptz");
			expect(query.params).toContain("updatedAt");
		});

		it("rejects unsupported entity schema columns", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });

			expect(() =>
				compiler.compile(createEntitySchemaExpression("propertiesSchema")),
			).toThrow("Unsupported entity schema column");
		});

		it("does not apply multi-schema CASE WHEN wrapping", () => {
			const compiler = createTestCompiler({ context, alias: "entities" });

			const query = dialect.sqlToQuery(
				compiler.compile(createEntitySchemaExpression("slug")),
			);

			expect(query.sql).not.toContain("case when");
		});
	});
});
