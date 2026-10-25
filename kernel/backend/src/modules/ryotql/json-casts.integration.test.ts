import { assert, expect, layer } from "@effect/vitest";
import {
	type NamedQuery,
	RowsResult,
	type ScalarExpression,
} from "@ryot-app/contract/modules/ryotql/language";
import {
	ascending,
	castBoolean,
	castDate,
	castNumber,
	castText,
	column,
	conditional,
	eq,
	field,
	first,
	join,
	jsonArrayCount,
	jsonElement,
	jsonElementsJoin,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import { eq as databaseEq, sql } from "drizzle-orm";
import { Effect, Layer, Logger, References, Schema } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { RyotQLService } from "./service";

const source = table("event", "source");
const subject = table("entity", "subject");
const occurredAt = new Date("2026-01-01T00:00:00.000Z");
const encodeRows = Schema.encodeEffect(Schema.fromJsonString(RowsResult));
const numericInputs = [
	"0",
	"-0",
	"0.0000",
	"1",
	"-1",
	"0.1",
	"1.2300",
	"9007199254740991",
	"9007199254740992",
	"9007199254740993",
	"1.23456789012345678901234567890123456789",
	"1.00000000000000011102230246251565404236316680908203125",
	"1.00000000000000011102230246251565404236316680908203126",
	"1.7976931348623157e308",
	"1.7976931348623158e308",
	"1.7976931348623159e308",
	"-1.7976931348623157e308",
	"-1.7976931348623159e308",
	"1e400",
	"-1e400",
	"2.2250738585072014e-308",
	"2.225073858507201e-308",
	"4.9406564584124654e-324",
	"5e-324",
	"-5e-324",
	"2.4703282292062326e-324",
	"2.4703282292062328e-324",
	"1e-324",
	"-1e-324",
	"1e-400",
	"-1e-400",
];
const shapeInputs = [
	"null",
	"3",
	'"root"',
	"false",
	"[]",
	'[{"nested":{"value":3}}]',
	"{}",
	'{"nested":null}',
	'{"nested":true}',
	'{"nested":[{"value":3}]}',
	'{"nested":{}}',
	'{"nested":{"value":null}}',
	'{"nested":{"value":[]}}',
	'{"nested":{"value":{}}}',
	'{"nested":{"value":[3]}}',
	...["", "null", "3", "true", "1e", "NaN", "Infinity", " \t", "'\"\\\n日本語🧪"].map((value) =>
		JSON.stringify({ nested: { value } }),
	),
	'{"nested":{"value":true}}',
	'{"nested":{"value":false}}',
	'{"nested":{"value":3}}',
];
const keys = [
	"",
	"'",
	'"',
	"\\",
	"a.b",
	"a[0]",
	"@.double()",
	"$",
	"*",
	"**",
	'x") || true || ("',
	"x'); SELECT 1; --",
	"日本語",
	"🧪",
	"é",
	"e\u0301",
	"\n\t\x01",
	"\\u0061",
];

const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db.insert(tables.user).values([
				{ id: "owner", name: "Owner", email: "owner@example.test" },
				{ id: "other", name: "Other", email: "other@example.test" },
			]);
			yield* db.insert(tables.entity).values([
				{
					id: "subject",
					userId: "owner",
					name: "Subject",
					entitySchemaSlug: "subject",
					properties: { label: "canonical" },
				},
				{ id: "private", userId: "other", name: "Private", entitySchemaSlug: "subject" },
			]);
			yield* db
				.insert(tables.entityTranslation)
				.values({
					language: "es",
					entityId: "subject",
					populatedAt: occurredAt,
					sourceContentGeneration: 1,
					properties: { label: "translated" },
				});
			yield* db
				.insert(tables.event)
				.values([
					...[
						...numericInputs.map((value, index) => ({
							eventSchemaSlug: "number",
							id: `number-${String(index).padStart(2, "0")}`,
							properties: sql`${`{"nested":{"value":${value}}}`}::jsonb`,
						})),
						...shapeInputs.map((value, index) => ({
							eventSchemaSlug: "shape",
							properties: sql`${value}::jsonb`,
							id: `shape-${String(index).padStart(2, "0")}`,
						})),
						{
							id: "keys",
							eventSchemaSlug: "keys",
							properties: Object.fromEntries(
								keys.map((key) => [key, { text: key, number: 3, boolean: false }]),
							),
						},
						{ id: "array", eventSchemaSlug: "fallback", properties: sql`'[3]'::jsonb` },
						{
							id: "fallback",
							eventSchemaSlug: "fallback",
							properties: { "0": 4, " 0": 5, "�": "replacement", items: [{ value: "x" }] },
						},
						{
							id: "mutable",
							eventSchemaSlug: "mutable",
							properties: { enabled: true, nested: { value: 3 } },
						},
					].map((value) =>
						Object.assign(value, { occurredAt, userId: "owner", entityId: "subject" }),
					),
					{
						occurredAt,
						id: "hidden",
						userId: "other",
						entityId: "private",
						eventSchemaSlug: "mutable",
						properties: { enabled: true, nested: { value: 99 } },
					},
				]);
		}),
	);
});

const databaseLayer = Layer.merge(RyotQLService.layer, Layer.effectDiscard(seed)).pipe(
	Layer.provideMerge(isolatedDatabaseLayer("ryotql_json_casts")),
);

const execute = Effect.fn(function* (query: NamedQuery, language: null | string = null) {
	const service = yield* RyotQLService;
	let statement = "";
	const logger = Logger.make((entry) => {
		const value = entry.fiber.getRef(References.CurrentLogAnnotations)["sql"];
		if (typeof value === "string") {
			statement = value;
		}
	});
	const result = (yield* service
		.executeForUser("owner", language, "plugin", { queries: { rows: query } })
		.pipe(
			Effect.provideService(Logger.CurrentLoggers, new Set([logger])),
			Effect.provideService(References.MinimumLogLevel, "Trace"),
		)).data["rows"];
	assert(result?.type === "rows");
	return { result, statement };
});

const payload = (baseline: boolean): ScalarExpression =>
	baseline
		? conditional(eq(literal(1), literal(1)), column(source, "properties"), literal(null))
		: column(source, "properties");

const numericQuery = (baseline: boolean) =>
	rows(source, {
		limit: 100,
		where: eq(column(source, "eventSchemaSlug"), literal("number")),
		fields: [field("value", castNumber(jsonPath(payload(baseline), "nested", "value")))],
	});

const shapeQuery = (baseline: boolean) => {
	const value = jsonPath(payload(baseline), "nested", "value");
	return rows(source, {
		limit: 100,
		where: eq(column(source, "eventSchemaSlug"), literal("shape")),
		fields: [
			field("text", castText(value)),
			field("number", castNumber(value)),
			field("boolean", castBoolean(value)),
		],
	});
};

const keyQuery = (baseline: boolean) =>
	rows(source, {
		where: eq(column(source, "id"), literal("keys")),
		fields: keys.flatMap((key, index) => [
			field(`text${index}`, castText(jsonPath(payload(baseline), key, "text"))),
			field(`number${index}`, castNumber(jsonPath(payload(baseline), key, "number"))),
			field(`boolean${index}`, castBoolean(jsonPath(payload(baseline), key, "boolean"))),
		]),
	});

layer(databaseLayer)((test) => {
	test.effect(
		"preserves numeric boundaries and rejects overflow and underflow without rounding",
		() =>
			Effect.gen(function* () {
				const actual = yield* execute(numericQuery(false));
				const baseline = yield* execute(numericQuery(true));
				expect(yield* encodeRows(actual.result)).toBe(yield* encodeRows(baseline.result));
				expect(actual.result.items.map((item) => item["value"])).toEqual([
					0,
					0,
					0,
					1,
					-1,
					0.1,
					1.23,
					9007199254740991,
					9007199254740992,
					9007199254740992,
					1.2345678901234567,
					1,
					1.0000000000000002,
					Number.MAX_VALUE,
					Number.MAX_VALUE,
					null,
					-Number.MAX_VALUE,
					null,
					null,
					null,
					2.2250738585072014e-308,
					2.225073858507201e-308,
					Number.MIN_VALUE,
					Number.MIN_VALUE,
					-Number.MIN_VALUE,
					null,
					Number.MIN_VALUE,
					null,
					null,
					null,
					null,
				]);
				expect(actual.statement).toContain("jsonb_path_query_first(");
				expect(actual.statement).not.toContain("pg_input_is_valid(");
				expect(baseline.statement).not.toContain("jsonb_path_query_first(");
				expect(baseline.statement).toContain("pg_input_is_valid(");
			}),
	);

	test.effect("keeps nulls, scalar kinds and strict object traversal unchanged", () =>
		Effect.gen(function* () {
			const actual = yield* execute(shapeQuery(false));
			expect(yield* encodeRows(actual.result)).toBe(
				yield* encodeRows((yield* execute(shapeQuery(true))).result),
			);
			expect(actual.result.items.slice(0, 15)).toEqual(
				Array.from({ length: 15 }, () => ({ text: null, number: null, boolean: null })),
			);
			expect(actual.result.items.slice(15)).toEqual([
				...["", "null", "3", "true", "1e", "NaN", "Infinity", " \t", "'\"\\\n日本語🧪"].map(
					(text) => ({ text, number: null, boolean: null }),
				),
				{ text: null, number: null, boolean: true },
				{ text: null, number: null, boolean: false },
				{ number: 3, text: null, boolean: null },
			]);
		}),
	);

	test.effect(
		"binds quoted and Unicode object keys without interpreting them as paths or SQL",
		() =>
			Effect.gen(function* () {
				const actual = yield* execute(keyQuery(false));
				expect(yield* encodeRows(actual.result)).toBe(
					yield* encodeRows((yield* execute(keyQuery(true))).result),
				);
				expect(actual.result.items).toEqual([
					Object.fromEntries(
						keys.flatMap((key, index) => [
							[`text${index}`, key],
							[`number${index}`, 3],
							[`boolean${index}`, false],
						]),
					),
				]);
				expect(actual.statement).toMatch(/\$\d+::jsonpath/);
				expect(actual.statement).not.toContain("SELECT 1; --");
			}),
	);

	test.effect(
		"retains array indexes, integer-like object keys and malformed Unicode fallback",
		() =>
			Effect.gen(function* () {
				const indexes = yield* execute(
					rows(source, {
						where: eq(column(source, "id"), literal("array")),
						fields: [0, "0", "+0", " 0", "\t0", "00", "-1"].map((key, index) =>
							field(`value${index}`, castNumber(jsonPath(column(source, "properties"), key))),
						),
					}),
				);
				expect(indexes.result.items).toEqual([
					{ value0: 3, value1: 3, value2: 3, value3: 3, value4: 3, value5: 3, value6: 3 },
				]);
				expect(indexes.statement).not.toContain("jsonb_path_query_first(");
				const objects = yield* execute(
					rows(source, {
						where: eq(column(source, "id"), literal("fallback")),
						fields: [
							field("zero", castNumber(jsonPath(column(source, "properties"), "0"))),
							field("space", castNumber(jsonPath(column(source, "properties"), " 0"))),
							field("unicode", castText(jsonPath(column(source, "properties"), "\ud800"))),
						],
					}),
				);
				expect(objects.result.items).toEqual([{ zero: 4, space: 5, unicode: "replacement" }]);
				expect(objects.statement).not.toContain("jsonb_path_query_first(");
			}),
	);

	test.effect("retains localized, subquery, JSON-element and non-JSON input cast behavior", () =>
		Effect.gen(function* () {
			const localized = rows(subject, {
				where: eq(column(subject, "id"), literal("subject")),
				fields: [field("label", castText(jsonPath(column(subject, "properties"), "label")))],
			});
			const canonical = yield* execute(localized);
			const translated = yield* execute(localized, "es");
			expect(canonical.result.items).toEqual([{ label: "canonical" }]);
			expect(translated.result.items).toEqual([{ label: "translated" }]);
			expect(canonical.statement).not.toContain("jsonb_path_query_first(");
			expect(translated.statement).not.toContain("jsonb_path_query_first(");
			const nested = yield* execute(
				rows(subject, {
					where: eq(column(subject, "id"), literal("subject")),
					fields: [
						field(
							"first",
							castNumber(
								jsonPath(
									first(source, {
										select: column(source, "properties"),
										orderBy: [ascending(column(source, "id"))],
										where: eq(column(source, "id"), literal("number-03")),
									}),
									"nested",
									"value",
								),
							),
						),
						field("number", castNumber(literal("3"))),
						field("boolean", castBoolean(literal("true"))),
						field("date", castDate(literal("2026-01-01"))),
					],
				}),
			);
			expect(nested.result.items).toEqual([
				{ first: 1, number: 3, boolean: true, date: "2026-01-01T00:00:00.000Z" },
			]);
			expect(nested.statement).not.toContain("jsonb_path_query_first(");
			const items = jsonPath(column(source, "properties"), "items");
			const element = jsonElementsJoin("inner", "element", items);
			const elements = yield* execute(
				rows(source, {
					joins: [element],
					where: eq(column(source, "id"), literal("fallback")),
					fields: [
						field("value", castText(jsonPath(column(element, "value"), "value"))),
						field(
							"count",
							jsonArrayCount(items, eq(castText(jsonPath(jsonElement(), "value")), literal("x"))),
						),
					],
				}),
			);
			expect(elements.result.items).toEqual([{ count: 1, value: "x" }]);
			expect(elements.statement).not.toContain("jsonb_path_query_first(");
		}),
	);

	test.effect("keeps nullable private joins and conditional values fresh across executions", () =>
		Effect.gen(function* () {
			const value = castNumber(jsonPath(column(source, "properties"), "nested", "value"));
			const enabled = castBoolean(jsonPath(column(source, "properties"), "enabled"));
			const query = (id: string) =>
				rows(subject, {
					where: eq(column(subject, "id"), literal("subject")),
					joins: [join("left", source, eq(column(source, "id"), literal(id)))],
					fields: [
						field("value", value),
						field("enabled", enabled),
						field("conditional", conditional(eq(enabled, literal(true)), value, literal(0))),
						field("projection", castText(jsonPath(column(source, "projection"), "label"))),
					],
				});
			expect((yield* execute(query("hidden"))).result.items).toEqual([
				{ value: null, enabled: null, conditional: 0, projection: null },
			]);
			const reused = query("mutable");
			expect((yield* execute(reused)).result.items).toEqual([
				{ value: 3, enabled: true, conditional: 3, projection: null },
			]);
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.update(tables.event)
					.set({ properties: { enabled: false, nested: { value: 4 } } })
					.where(databaseEq(tables.event.id, "mutable")),
			);
			expect((yield* execute(reused)).result.items).toEqual([
				{ value: 4, enabled: false, conditional: 0, projection: null },
			]);
		}),
	);
});
