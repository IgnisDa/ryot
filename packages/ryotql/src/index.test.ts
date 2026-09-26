import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { Recipe } from "./index";
import {
	add,
	aggregate,
	and,
	ascending,
	average,
	castBoolean,
	castDate,
	castJson,
	castNumber,
	castText,
	coalesce,
	column,
	concat,
	contains,
	conditional,
	count,
	countDistinct,
	defineRecipe,
	dateBucket,
	document,
	divide,
	eq,
	field,
	floor,
	first,
	gt,
	groupDescending,
	gte,
	exists,
	isNotNull,
	isNull,
	include,
	integer,
	join,
	jsonArrayCount,
	jsonArrayExists,
	jsonArrayFirst,
	jsonElement,
	jsonPath,
	literal,
	lt,
	lte,
	maximum,
	measure,
	measureDescending,
	minimum,
	multiply,
	neq,
	not,
	or,
	rows,
	star,
	subtract,
	sum,
	table,
	timeSeries,
	titleCase,
	kebabCase,
	round,
	selectedField,
	selectedAggregate,
	selectedInclude,
	selectedMeasure,
	selectedOptionalRow,
	selectedRow,
	selectedRows,
	selectedTimeSeries,
} from "./index";

describe("RyotQL builders", () => {
	it("builds serializable named rows with defaults and omitted optional fields", () => {
		const entity = table("entity", "entity");

		expect(
			document({ entities: rows(entity, { fields: [field("id", column(entity, "id"))] }) }),
		).toEqual({
			queries: {
				entities: {
					from: { table: "entity", alias: "entity" },
					output: {
						type: "rows",
						pagination: { limit: 20 },
						fields: [{ key: "id", expr: { field: "id", type: "column", tableAlias: "entity" } }],
						orderBy: [
							{ direction: "asc", expr: { field: "id", type: "column", tableAlias: "entity" } },
						],
					},
				},
			},
		});
	});

	it("builds timezone-aware date buckets and aggregate group ordering", () => {
		const event = table("event", "event");
		const day = dateBucket(column(event, "occurredAt"), {
			bucket: "day",
			timeZone: "America/New_York",
		});
		const query = aggregate(event, {
			limit: 30,
			groupBy: [field("day", day)],
			orderBy: [groupDescending("day")],
			measures: [measure("count", { function: "count" })],
		});

		expect(query.output).toEqual({
			limit: 30,
			type: "aggregate",
			orderBy: [{ key: "day", direction: "desc" }],
			measures: [{ key: "count", aggregation: { function: "count" } }],
			groupBy: [
				{
					key: "day",
					expr: {
						bucket: "day",
						type: "dateBucket",
						timeZone: "America/New_York",
						expr: { type: "column", tableAlias: "event", field: "occurredAt" },
					},
				},
			],
		});
	});

	it("builds JSON array operators with element-scope expressions", () => {
		const entity = table("entity", "entity");
		const schedule = jsonPath(column(entity, "properties"), "airingSchedule");
		const airingAt = castDate(jsonPath(jsonElement(), "airingAt"));
		const upcoming = gt(airingAt, castDate(literal("2026-09-01T00:00:00.000Z")));

		expect(jsonArrayExists(schedule, upcoming)).toEqual({
			array: schedule,
			where: upcoming,
			type: "jsonExists",
		});
		expect(jsonArrayCount(schedule)).toEqual({ array: schedule, type: "jsonCount" });
		expect(
			jsonArrayFirst(schedule, {
				where: upcoming,
				select: airingAt,
				orderBy: [ascending(airingAt)],
			}),
		).toEqual({
			array: schedule,
			where: upcoming,
			select: airingAt,
			type: "jsonFirst",
			orderBy: [{ expr: airingAt, direction: "asc" }],
		});
	});

	it("compiles selected rows from object keys and decodes plain values and codecs", () => {
		const entity = table("entity", "entity");
		const EntityId = Schema.String.pipe(Schema.brand("EntityId"));
		const query = selectedRows(entity, {
			limit: 1,
			selection: {
				entityId: selectedField(column(entity, "id"), EntityId),
				score: selectedField(column(entity, "score"), Schema.NumberFromString),
			},
		});
		const result = query.decodeResult({
			type: "rows",
			items: [{ score: "42", entityId: "entity-1" }],
			pageInfo: { limit: 1, hasMore: false, nextCursor: null },
		});

		expect(query.document.output.fields).toEqual([
			{ key: "entityId", expr: column(entity, "id") },
			{ key: "score", expr: column(entity, "score") },
		]);
		expect(Result.getOrThrow(result)).toEqual({
			items: [{ score: 42, entityId: "entity-1" }],
			pageInfo: { limit: 1, hasMore: false, nextCursor: null },
		});
	});

	it("supports parameterized recipe builders", () => {
		const recipe = defineRecipe((input: { readonly entitySchemaSlug: string }) => {
			const entity = table("entity", "entity");
			return {
				map: () => Result.succeed(input.entitySchemaSlug),
				queries: {
					entities: selectedRows(entity, {
						selection: { id: selectedField(column(entity, "id"), Schema.String) },
						where: eq(column(entity, "entitySchemaSlug"), literal(input.entitySchemaSlug)),
					}),
				},
			};
		});
		const prepared = recipe({ entitySchemaSlug: "course" });

		expect(prepared.document).toMatchObject({
			queries: { entities: { where: { right: { value: "course" } } } },
		});
		const success = Result.getOrThrow(
			prepared.decode({
				data: {
					entities: {
						type: "rows",
						items: [{ id: "entity-1" }],
						pageInfo: { limit: 20, hasMore: false, nextCursor: null },
					},
				},
			}),
		) satisfies Recipe.Success<typeof recipe>;
		expect(success).toBe("course");
	});

	it("defaults recipe success to decoded queries without a mapper", () => {
		const entity = table("entity", "entity");
		const recipe = defineRecipe(() => ({
			queries: {
				entities: selectedRows(entity, {
					selection: { id: selectedField(column(entity, "id"), Schema.String) },
				}),
			},
		}));
		const success = Result.getOrThrow(
			recipe().decode({
				data: {
					entities: {
						type: "rows",
						items: [{ id: "entity-1" }],
						pageInfo: { limit: 20, hasMore: false, nextCursor: null },
					},
				},
			}),
		);

		expect(success.entities.items[0]?.id).toBe("entity-1");
	});

	it("rejects missing and malformed selected fields", () => {
		const entity = table("entity", "entity");
		const query = selectedRows(entity, {
			selection: { entityId: selectedField(column(entity, "id"), Schema.String) },
		});
		const pageInfo = { limit: 1, hasMore: false, nextCursor: null };

		expect(Result.isFailure(query.decodeResult({ pageInfo, items: [{}], type: "rows" }))).toBe(
			true,
		);
		expect(
			Result.isFailure(query.decodeResult({ pageInfo, type: "rows", items: [{ entityId: 1 }] })),
		).toBe(true);
	});

	it("decodes required and optional row cardinality and rejects extra or wrong results", () => {
		const entity = table("entity", "entity");
		const selection = { id: selectedField(column(entity, "id"), Schema.String) };
		const required = selectedRow(entity, { selection });
		const optional = selectedOptionalRow(entity, { selection });
		const pageInfo = { limit: 2, hasMore: false, nextCursor: null };

		expect(required.document.output).toMatchObject({ pagination: { limit: 2 } });
		expect(
			Result.getOrThrow(
				required.decodeResult({ pageInfo, type: "rows", items: [{ id: "entity-1" }] }),
			),
		).toEqual({ id: "entity-1" });
		expect(
			Result.getOrThrow(optional.decodeResult({ pageInfo, items: [], type: "rows" })),
		).toBeUndefined();
		expect(Result.isFailure(required.decodeResult({ pageInfo, items: [], type: "rows" }))).toBe(
			true,
		);
		expect(
			Result.isFailure(
				optional.decodeResult({ pageInfo, type: "rows", items: [{ id: "1" }, { id: "2" }] }),
			),
		).toBe(true);
		expect(Result.isFailure(required.decodeResult({ items: [], type: "aggregate" }))).toBe(true);
	});

	it("derives and recursively decodes typed includes", () => {
		const entity = table("entity", "entity");
		const child = table("entity", "child");
		const leaf = table("entity", "leaf");
		const leaves = selectedInclude(leaf, {
			limit: 2,
			orderBy: [ascending(column(leaf, "id"))],
			selection: { label: selectedField(column(leaf, "name"), Schema.String) },
		});
		const children = selectedInclude(child, {
			limit: 2,
			include: { leaves },
			orderBy: [ascending(column(child, "id"))],
			selection: { id: selectedField(column(child, "id"), Schema.String) },
		});
		const query = selectedRows(entity, {
			include: { children },
			selection: { id: selectedField(column(entity, "id"), Schema.String) },
		});
		const decoded = Result.getOrThrow(
			query.decodeResult({
				type: "rows",
				pageInfo: { limit: 20, hasMore: false, nextCursor: null },
				items: [
					{
						id: "parent",
						children: {
							pageInfo: { limit: 2, hasMore: false },
							items: [
								{
									id: "child",
									leaves: { items: [{ label: "Leaf" }], pageInfo: { limit: 2, hasMore: false } },
								},
							],
						},
					},
				],
			}),
		);

		expect(query.document.output.include?.[0]).toMatchObject({
			key: "children",
			fields: [{ key: "id" }],
			include: [{ key: "leaves", fields: [{ key: "label" }] }],
		});
		expect(decoded.items[0]?.children.items[0]?.leaves.items[0]?.label).toBe("Leaf");
	});

	it("decodes grouped and required ungrouped selected aggregates", () => {
		const entity = table("entity", "entity");
		const grouped = selectedAggregate(entity, {
			groupBy: { status: selectedField(column(entity, "status"), Schema.String) },
			measures: { count: selectedMeasure({ function: "count" }, Schema.NumberFromString) },
		});
		const countQuery = selectedAggregate(entity, {
			measures: { count: selectedMeasure({ function: "count" }, Schema.Number) },
		});

		expect(grouped.document.output).toMatchObject({
			groupBy: [{ key: "status" }],
			measures: [{ key: "count", aggregation: { function: "count" } }],
		});
		expect(
			Result.getOrThrow(
				grouped.decodeResult({
					type: "aggregate",
					pageInfo: { limit: 20, hasMore: false },
					items: [{ count: "2", status: "active" }],
				}),
			).items,
		).toEqual([{ count: 2, status: "active" }]);
		expect(
			Result.getOrThrow(countQuery.decodeResult({ type: "aggregate", items: [{ count: 3 }] })),
		).toEqual({ count: 3 });
		expect(Result.isFailure(countQuery.decodeResult({ items: [], type: "aggregate" }))).toBe(true);
	});

	it("decodes selected time-series bucket boundaries and values", () => {
		const event = table("event", "event");
		const query = selectedTimeSeries(event, {
			bucket: "day",
			endAt: "2026-01-02",
			startAt: "2026-01-01",
			measure: { function: "count" },
			time: column(event, "occurredAt"),
			selection: { endAt: Schema.String, startAt: Schema.String, value: Schema.NumberFromString },
		});

		expect(
			Result.getOrThrow(
				query.decodeResult({
					type: "timeSeries",
					buckets: [{ value: "4", endAt: "2026-01-02", startAt: "2026-01-01" }],
				}),
			),
		).toEqual({ buckets: [{ value: 4, endAt: "2026-01-02", startAt: "2026-01-01" }] });
		expect(Result.isFailure(query.decodeResult({ items: [], type: "aggregate" }))).toBe(true);
	});

	it("decodes multiple named queries and infers recipe success for zero-argument factories", () => {
		const entity = table("entity", "entity");
		const recipe = defineRecipe(() => ({
			map: ({ count: countResult, first: firstResult }) =>
				Result.succeed({ count: countResult.count, firstId: firstResult?.id }),
			queries: {
				first: selectedOptionalRow(entity, {
					selection: { id: selectedField(column(entity, "id"), Schema.String) },
				}),
				count: selectedAggregate(entity, {
					measures: { count: selectedMeasure({ function: "count" }, Schema.Number) },
				}),
			},
		}));
		const success = Result.getOrThrow(
			recipe().decode({
				data: {
					count: { type: "aggregate", items: [{ count: 1 }] },
					first: {
						type: "rows",
						items: [{ id: "entity-1" }],
						pageInfo: { limit: 2, hasMore: false, nextCursor: null },
					},
				},
			}),
		) satisfies Recipe.Success<typeof recipe>;

		expect(success).toEqual({ count: 1, firstId: "entity-1" });
		expect(Result.isFailure(recipe().decode({ data: { count: {} } }))).toBe(true);
	});

	it("builds qualified wildcard row selections", () => {
		const entity = table("entity", "entity");

		expect(rows(entity, { fields: [star(entity)] }).output.fields).toEqual([
			{ type: "wildcard", tableAlias: "entity" },
		]);
	});

	it("preserves table aliases in expressions and explicit rows options", () => {
		const entity = table("entity", "collection");
		const query = rows(entity, {
			limit: 7,
			after: "cursor",
			orderBy: [ascending(column(entity, "name"))],
			fields: [field("name", column(entity, "name"))],
			where: eq(column(entity, "entitySchemaSlug"), literal("collection")),
		});

		expect(query).toMatchObject({
			output: { pagination: { limit: 7, after: "cursor" } },
			where: { right: { value: "collection" }, left: { tableAlias: "collection" } },
		});
	});

	it("builds JSON, cast, comparison, boolean, null, containment, and coalesce expressions", () => {
		const entity = table("entity", "entity");
		const nested = jsonPath(column(entity, "properties"), "details", 0, "score");
		const score = castNumber(nested);

		const query = rows(entity, {
			fields: [
				field("text", castText(nested)),
				field("date", castDate(nested)),
				field("json", castJson(nested)),
				field("score", score),
				field("boolean", castBoolean(nested)),
				field("fallback", coalesce(nested, literal("unknown"))),
			],
			where: and(
				eq(score, literal(1)),
				neq(score, literal(2)),
				gt(score, literal(0)),
				gte(score, literal(1)),
				lt(score, literal(2)),
				lte(score, literal(1)),
				contains(castText(nested), literal("_%")),
				isNotNull(nested),
				not(isNull(nested)),
				or(),
			),
		});

		expect(query.where).toMatchObject({ type: "and" });
		if (query.where?.type !== "and") {
			throw new Error("Expected conjunction");
		}
		expect(query.where.predicates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ operator: "gt", type: "comparison" }),
				expect.objectContaining({ type: "contains" }),
				expect.objectContaining({ type: "not" }),
				{ type: "or", predicates: [] },
			]),
		);
		expect(query.output.fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "score",
					expr: expect.objectContaining({ type: "cast", target: "number" }),
				}),
				expect.objectContaining({
					key: "fallback",
					expr: expect.objectContaining({ type: "coalesce" }),
				}),
			]),
		);
	});

	it("builds scalar text, conditional, and unary expressions", () => {
		const entity = table("entity", "entity");
		const value = column(entity, "name");

		expect(
			rows(entity, {
				fields: [
					field("concat", concat(value, literal(" suffix"))),
					field(
						"conditional",
						conditional(eq(value, literal("Ryot")), literal("yes"), literal("no")),
					),
					field("title", titleCase(value)),
					field("kebab", kebabCase(value)),
					field("round", round(literal(1.5))),
					field("floor", floor(literal(1.5))),
					field("integer", integer(literal(-1.5))),
					field("notNull", isNotNull(value)),
				],
			}),
		).toMatchObject({
			output: {
				fields: expect.arrayContaining([
					expect.objectContaining({
						key: "concat",
						expr: expect.objectContaining({ type: "concat" }),
					}),
					expect.objectContaining({
						key: "conditional",
						expr: expect.objectContaining({ type: "conditional" }),
					}),
					expect.objectContaining({
						key: "title",
						expr: expect.objectContaining({ name: "titleCase", type: "transform" }),
					}),
					expect.objectContaining({
						key: "kebab",
						expr: expect.objectContaining({ name: "kebabCase", type: "transform" }),
					}),
					expect.objectContaining({
						key: "round",
						expr: expect.objectContaining({ type: "round" }),
					}),
					expect.objectContaining({
						key: "floor",
						expr: expect.objectContaining({ type: "floor" }),
					}),
					expect.objectContaining({
						key: "integer",
						expr: expect.objectContaining({ type: "integer" }),
					}),
					expect.objectContaining({
						key: "notNull",
						expr: expect.objectContaining({ type: "isNotNull" }),
					}),
				]),
			},
		});
	});

	it("rejects non-finite literal numbers", () => {
		expect(() => literal(Number.POSITIVE_INFINITY)).toThrow(
			"RyotQL literals require finite numbers",
		);
		expect(() => literal({ nested: [1, Number.NaN] })).toThrow(
			"RyotQL literals require finite numbers",
		);
	});

	it("builds joined correlated includes and omits absent options", () => {
		const course = table("entity", "course");
		const courseModule = table("relationship", "courseModule");
		const module = table("entity", "module");
		const modules = include(courseModule, {
			limit: 2,
			key: "modules",
			orderBy: [ascending(column(module, "name"))],
			fields: [field("name", column(module, "name"))],
			where: eq(column(courseModule, "sourceEntityId"), column(course, "id")),
			joins: [
				join("inner", module, eq(column(courseModule, "targetEntityId"), column(module, "id"))),
			],
		});

		expect(rows(course, { fields: [], include: [modules] })).toMatchObject({
			output: {
				include: [
					{
						limit: 2,
						key: "modules",
						from: { table: "relationship", alias: "courseModule" },
						joins: [{ type: "inner", table: { table: "entity", alias: "module" } }],
					},
				],
			},
		});
		expect(
			include(module, {
				limit: 1,
				fields: [],
				key: "empty",
				orderBy: [ascending(column(module, "id"))],
			}),
		).not.toHaveProperty("joins");
	});

	it("builds correlated, aggregate, and arithmetic expressions", () => {
		const entity = table("entity", "entity");
		const event = table("event", "event");
		const related = { where: eq(column(event, "entityId"), column(entity, "id")) };
		const eventCount = count(event, related);
		const query = rows(entity, {
			where: exists(event, related),
			fields: [
				field(
					"latest",
					first(event, {
						...related,
						select: column(event, "occurredAt"),
						orderBy: [ascending(column(event, "occurredAt"))],
					}),
				),
				field("count", eventCount),
				field("distinct", countDistinct(event, column(event, "entityId"), related)),
				field("sum", sum(event, literal(1), related)),
				field("average", average(event, literal(1), related)),
				field("minimum", minimum(event, literal(1), related)),
				field("maximum", maximum(event, literal(1), related)),
				field(
					"arithmetic",
					add(
						subtract(eventCount, literal(1)),
						multiply(divide(eventCount, literal(2)), literal(3)),
					),
				),
			],
		});

		expect(query.where).toEqual({
			type: "exists",
			query: { where: related.where, from: { table: "event", alias: "event" } },
		});
		expect(query.output.fields).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					key: "latest",
					expr: expect.objectContaining({ type: "first" }),
				}),
				expect.objectContaining({
					key: "distinct",
					expr: expect.objectContaining({
						type: "aggregate",
						aggregation: { function: "countDistinct", expr: column(event, "entityId") },
					}),
				}),
				expect.objectContaining({
					key: "arithmetic",
					expr: expect.objectContaining({ operator: "add", type: "arithmetic" }),
				}),
			]),
		);
	});

	it("builds grouped and ungrouped aggregate outputs", () => {
		const lesson = table("entity", "lesson");
		const countIdentifier = measure("count", { function: "count" });
		const difficulty = field("difficulty", jsonPath(column(lesson, "properties"), "difficulty"));

		expect(aggregate(lesson, { measures: [countIdentifier] })).toEqual({
			from: { table: "entity", alias: "lesson" },
			output: { type: "aggregate", measures: [countIdentifier] },
		});
		expect(
			aggregate(lesson, {
				limit: 10,
				groupBy: [difficulty],
				measures: [countIdentifier],
				orderBy: [measureDescending("count")],
				where: eq(column(lesson, "entitySchemaSlug"), literal("lesson")),
			}),
		).toMatchObject({
			where: { type: "comparison" },
			output: {
				limit: 10,
				type: "aggregate",
				groupBy: [difficulty],
				measures: [countIdentifier],
				orderBy: [{ key: "count", direction: "desc" }],
			},
		});
	});

	it("builds time-series outputs with generic query options", () => {
		const event = table("event", "event");
		const entity = table("entity", "entity");
		const occurredAt = column(event, "occurredAt");
		const query = timeSeries(event, {
			bucket: "day",
			time: occurredAt,
			endAt: "2026-01-03T00:00:00.000Z",
			startAt: "2026-01-01T00:00:00.000Z",
			measure: { function: "sum", expr: literal(1) },
			where: eq(column(event, "eventSchemaSlug"), literal("completion")),
			joins: [join("inner", entity, eq(column(event, "entityId"), column(entity, "id")))],
		});

		expect(query).toEqual({
			from: { table: "event", alias: "event" },
			where: {
				operator: "eq",
				type: "comparison",
				right: { type: "literal", value: "completion" },
				left: { type: "column", tableAlias: "event", field: "eventSchemaSlug" },
			},
			output: {
				type: "timeSeries",
				measure: { aggregation: { function: "sum", expr: { value: 1, type: "literal" } } },
				time: {
					bucket: "day",
					expr: occurredAt,
					range: { endAt: "2026-01-03T00:00:00.000Z", startAt: "2026-01-01T00:00:00.000Z" },
				},
			},
			joins: [
				{
					type: "inner",
					table: { table: "entity", alias: "entity" },
					on: {
						operator: "eq",
						type: "comparison",
						right: { field: "id", type: "column", tableAlias: "entity" },
						left: { type: "column", field: "entityId", tableAlias: "event" },
					},
				},
			],
		});
	});
});
