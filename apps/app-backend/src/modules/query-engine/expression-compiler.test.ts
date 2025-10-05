import { describe, expect, it } from "vitest";

import {
	createEntityPropertyExpression,
	createEntitySchemaExpression,
	createLiteralExpression,
	createTransformExpression,
} from "~/lib/query-language";

import {
	context,
	createComputedFieldExpression,
	createScalarTestCompiler,
	dialect,
	singleSchemaContext,
} from "./test-support";

const yearExpression = createEntityPropertyExpression("smartphones", "releaseYear");

describe("createScalarExpressionCompiler", () => {
	it("compiles nested computed fields for scalar query stages", () => {
		const compiler = createScalarTestCompiler({
			alias: "entities",
			context: singleSchemaContext,
			computedFields: [
				{
					key: "nextYear",
					expression: {
						left: yearExpression,
						right: createLiteralExpression(1),
						type: "arithmetic",
						operator: "add",
					},
				},
				{
					key: "label",
					expression: {
						type: "concat",
						values: [
							createLiteralExpression("Release "),
							createComputedFieldExpression("nextYear"),
						],
					},
				},
			],
		});

		const query = dialect.sqlToQuery(compiler.compile(createComputedFieldExpression("label")));

		expect(query.sql.toLowerCase()).toContain("concat(");
		expect(query.sql).toContain("entities.properties ->>");
	});

	it("reuses cached computed field expressions for the same target type", () => {
		const compiler = createScalarTestCompiler({
			alias: "entities",
			context: singleSchemaContext,
			computedFields: [
				{
					key: "nextYear",
					expression: {
						left: yearExpression,
						right: createLiteralExpression(1),
						type: "arithmetic",
						operator: "add",
					},
				},
			],
		});

		const first = compiler.compile(createComputedFieldExpression("nextYear"), "integer");
		const second = compiler.compile(createComputedFieldExpression("nextYear"), "integer");
		const third = compiler.compile(createComputedFieldExpression("nextYear"), "number");

		expect(first).toBe(second);
		expect(first).not.toBe(third);
	});

	it("compiles a nested entity property path using chained JSON traversal operators", () => {
		const compiler = createScalarTestCompiler({ alias: "entities", context: singleSchemaContext });

		const query = dialect.sqlToQuery(
			compiler.compile({
				type: "reference",
				reference: {
					type: "entity",
					slug: "smartphones",
					path: ["properties", "metadata", "source"],
				},
			}),
		);

		expect(query.sql).toContain("entities.properties ->");
		expect(query.sql).toContain("->>");
		expect(query.params.indexOf("metadata")).toBeLessThan(query.params.indexOf("source"));
	});

	it("rejects image computed fields in scalar sort and filter contexts", () => {
		const compiler = createScalarTestCompiler({
			alias: "entities",
			context: singleSchemaContext,
			computedFields: [
				{
					key: "cover",
					expression: {
						type: "reference",
						reference: { type: "entity", slug: "smartphones", path: ["image"] },
					},
				},
			],
		});

		expect(() => compiler.compile(createComputedFieldExpression("cover"), "string")).toThrow(
			"Image expressions are display-only and cannot be compiled for sort or filter usage",
		);
	});

	describe("event references", () => {
		it("compiles event.id as direct column access", () => {
			const compiler = createScalarTestCompiler({ alias: "events", context });

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: { type: "event", path: ["id"] },
				}),
			);

			expect(query.sql).toContain("events.id");
		});

		it("compiles event.createdAt with timestamptz cast", () => {
			const compiler = createScalarTestCompiler({ alias: "events", context });

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
			const compiler = createScalarTestCompiler({ alias: "events", context });

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
			const compiler = createScalarTestCompiler({ alias: "events", context });

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: {
						type: "event",
						path: ["properties", "rating"],
						eventSchemaSlug: "review",
					},
				}),
			);

			expect(query.sql.toLowerCase()).toContain("case when");
			expect(query.sql).toContain("event_schema_data ->>");
			expect(query.params).toContain("review");
			expect(query.params).toContain("rating");
		});

		it("rejects unsupported event built-in columns", () => {
			const compiler = createScalarTestCompiler({ alias: "events", context });

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
			const compiler = createScalarTestCompiler({ alias: "events", context });

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: { type: "event-schema", path: ["slug"] },
				}),
			);

			expect(query.sql).toContain("event_schema_data ->>");
			expect(query.params).toContain("slug");
		});

		it("compiles event-schema.isBuiltin with boolean cast", () => {
			const compiler = createScalarTestCompiler({ alias: "events", context });

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

		it("rejects unsupported event-schema columns", () => {
			const compiler = createScalarTestCompiler({ alias: "events", context });

			expect(() =>
				compiler.compile({
					type: "reference",
					reference: { type: "event-schema", path: ["propertiesSchema"] },
				}),
			).toThrow("Unsupported event schema column");
		});

		it("rejects nested event-schema paths", () => {
			const compiler = createScalarTestCompiler({ alias: "events", context });

			expect(() =>
				compiler.compile({
					type: "reference",
					reference: { type: "event-schema", path: ["slug", "nested"] },
				}),
			).toThrow("do not support nested paths");
		});
	});

	describe("entity column overrides in events mode", () => {
		const eventsContext = {
			...context,
			entityColumnOverrides: {
				id: "entity_id",
				properties: "entity_properties",
				created_at: "entity_created_at",
				updated_at: "entity_updated_at",
			},
		};

		it("reads entity properties from entity_properties when override is set", () => {
			const compiler = createScalarTestCompiler({ alias: "events", context: eventsContext });

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

		it("reads entity id from entity_id when override is set", () => {
			const compiler = createScalarTestCompiler({ alias: "events", context: eventsContext });

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: { type: "entity", slug: "smartphones", path: ["id"] },
				}),
			);

			expect(query.sql).toContain("events.entity_id");
			expect(query.sql).not.toContain("events.id");
		});
	});

	describe("transform expressions", () => {
		it("compiles titleCase transforms using initcap", () => {
			const compiler = createScalarTestCompiler({
				alias: "entities",
				context: singleSchemaContext,
			});

			const query = dialect.sqlToQuery(
				compiler.compile(
					createTransformExpression(
						"titleCase",
						createEntityPropertyExpression("smartphones", "nameplate"),
					),
				),
			);

			expect(query.sql).toContain("initcap(");
			expect(query.sql).toContain("replace(");
		});

		it("compiles kebabCase transforms using lower", () => {
			const compiler = createScalarTestCompiler({
				alias: "entities",
				context: singleSchemaContext,
			});

			const query = dialect.sqlToQuery(
				compiler.compile(
					createTransformExpression(
						"kebabCase",
						createEntityPropertyExpression("smartphones", "nameplate"),
					),
				),
			);

			expect(query.sql).toContain("lower(");
			expect(query.sql).toContain("replace(");
		});

		it("rejects image expressions inside transforms", () => {
			const compiler = createScalarTestCompiler({
				alias: "entities",
				context: singleSchemaContext,
			});

			expect(() =>
				compiler.compile(
					createTransformExpression("titleCase", {
						type: "reference",
						reference: { type: "entity", slug: "smartphones", path: ["image"] },
					}),
				),
			).toThrow("Image expressions are display-only");
		});
	});

	describe("relationship-join references", () => {
		it("compiles relationship built-in columns to JSONB extraction SQL", () => {
			const compiler = createScalarTestCompiler({ alias: "entities", context });

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: {
						type: "relationship-join",
						joinKey: "ownership",
						path: ["createdAt"],
					},
				}),
			);

			expect(query.sql).toContain("entities.relationship_join_ownership");
			expect(query.params).toContain("createdAt");
		});

		it("compiles relationship property paths to JSONB extraction SQL", () => {
			const compiler = createScalarTestCompiler({ alias: "entities", context });

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: {
						type: "relationship-join",
						joinKey: "ownership",
						path: ["properties", "rating"],
					},
				}),
			);

			expect(query.sql).toContain("entities.relationship_join_ownership");
			expect(query.sql).toContain("->>");
			expect(query.params).toContain("rating");
		});

		it("compiles related entity columns to nested JSON extraction SQL", () => {
			const compiler = createScalarTestCompiler({ alias: "entities", context });

			const query = dialect.sqlToQuery(
				compiler.compile({
					type: "reference",
					reference: {
						type: "relationship-join",
						joinKey: "ownership",
						path: ["sourceEntity", "name"],
					},
				}),
			);

			expect(query.sql).toContain("entities.relationship_join_ownership");
			expect(query.params).toContain("sourceEntity");
			expect(query.params).toContain("name");
		});

		it("compiles sourceEntity.image without a target type", () => {
			const compiler = createScalarTestCompiler({ alias: "entities", context });

			expect(() =>
				compiler.compile({
					type: "reference",
					reference: {
						type: "relationship-join",
						joinKey: "ownership",
						path: ["sourceEntity", "image"],
					},
				}),
			).not.toThrow();
		});

		it("throws when sourceEntity.image is compiled with a target type", () => {
			const compiler = createScalarTestCompiler({ alias: "entities", context });

			expect(() =>
				compiler.compile(
					{
						type: "reference",
						reference: {
							type: "relationship-join",
							joinKey: "ownership",
							path: ["sourceEntity", "image"],
						},
					},
					"string",
				),
			).toThrow(
				"Image expressions are display-only and cannot be compiled for sort or filter usage",
			);
		});
	});

	describe("entity-schema expressions", () => {
		it("compiles entity schema slug as a text extraction", () => {
			const compiler = createScalarTestCompiler({ alias: "entities", context });

			const query = dialect.sqlToQuery(compiler.compile(createEntitySchemaExpression("slug")));

			expect(query.sql).toContain("entity_schema_data ->>");
			expect(query.params).toContain("slug");
		});

		it("compiles entity schema createdAt with timestamptz cast", () => {
			const compiler = createScalarTestCompiler({ alias: "entities", context });

			const query = dialect.sqlToQuery(compiler.compile(createEntitySchemaExpression("createdAt")));

			expect(query.sql).toContain("entity_schema_data ->>");
			expect(query.sql).toContain("::timestamptz");
			expect(query.params).toContain("createdAt");
		});

		it("rejects unsupported entity schema columns", () => {
			const compiler = createScalarTestCompiler({ alias: "entities", context });

			expect(() => compiler.compile(createEntitySchemaExpression("propertiesSchema"))).toThrow(
				"Unsupported entity schema column",
			);
		});

		it("does not apply multi-schema CASE WHEN wrapping", () => {
			const compiler = createScalarTestCompiler({ alias: "entities", context });

			const query = dialect.sqlToQuery(compiler.compile(createEntitySchemaExpression("slug")));

			expect(query.sql.toLowerCase()).not.toContain("case when");
		});
	});
});
