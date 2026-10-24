import { CalendarSourceSlug, EntitySchemaSlug, PluginId } from "@ryot-app/contract/schema/brands";
import {
	castDate,
	castJson,
	castText,
	column,
	eq,
	field,
	gte,
	jsonPath,
	literal,
	lt,
	pluginId,
	table,
} from "@ryot-app/ryotql";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	calendarOccurrencesPageRecipe,
	type CalendarSource,
	calendarSourcesRecipe,
} from "./calendar";
import { requireRowsQuery, rowsResult } from "./test-utils";

const entity = table("entity", "record");
const owner = PluginId.make("plugin-1");
const startsAt = castDate(jsonPath(column(entity, "properties"), "startsAt"));

const source: CalendarSource = {
	art: "art",
	icon: "box",
	done: "done",
	name: "Tasks",
	isHidden: false,
	pluginId: owner,
	precision: "date",
	caption: "caption",
	startAt: "startsAt",
	pluginName: "Workspace",
	slug: CalendarSourceSlug.make("tasks"),
	sourceKey: JSON.stringify(["plugin-1", "tasks"]),
	subject: {
		entityAlias: "record",
		schemas: [
			{ slug: EntitySchemaSlug.make("record"), owner: { kind: "plugin", pluginId: owner } },
		],
	},
	query: {
		from: entity,
		where: eq(column(entity, "entitySchemaPluginId"), pluginId({ kind: "local", pluginId: owner })),
		output: {
			type: "rows",
			fields: [
				field("startsAt", startsAt),
				field("caption", castText(jsonPath(column(entity, "properties"), "label"))),
				field("art", castJson(jsonPath(column(entity, "properties"), "image"))),
				field("done", literal(true)),
				field("unused", column(entity, "name")),
			],
		},
	},
};

const window = {
	month: "2026-03",
	localEnd: "2026-04-01T05:00:00.000Z",
	localStart: "2026-03-01T05:00:00.000Z",
};

const occurrences = (input: Parameters<typeof calendarOccurrencesPageRecipe>[0]) =>
	Result.getOrThrow(calendarOccurrencesPageRecipe(input));

const occurrenceQuery = (input: Parameters<typeof calendarOccurrencesPageRecipe>[0]) =>
	requireRowsQuery(occurrences(input).document.queries["calendarOccurrences"]);

const row = {
	done: true,
	caption: "Step 2",
	__calendarSubjectName: "Alpha",
	__calendarSubjectId: "record-1",
	__calendarSubjectSchema: "record",
	__calendarSubjectOwner: "plugin-1",
	startsAt: "2026-03-14T00:00:00.000Z",
	art: { type: "local", key: "records/one.webp" },
};

const pageInfo = { limit: 100, hasMore: true, nextCursor: "next" };

describe("calendar recipes", () => {
	it("lists effective sources with their plugin and hidden state in an explicit order", () => {
		const query = requireRowsQuery(calendarSourcesRecipe().document.queries["calendarSources"]);
		expect(query).toMatchObject({
			from: { table: "calendarSource" },
			output: { pagination: { limit: 100 } },
			joins: [{ type: "inner", table: { table: "plugin" } }],
		});
		expect(query.output.orderBy.map(({ expr }) => expr)).toEqual([
			{ field: "name", type: "column", tableAlias: "calendarSourcePlugin" },
			{ field: "name", type: "column", tableAlias: "calendarSource" },
			{ type: "column", field: "pluginId", tableAlias: "calendarSource" },
			{ field: "slug", type: "column", tableAlias: "calendarSource" },
		]);
		const { sourceKey: _sourceKey, ...stored } = source;
		const decoded = Result.getOrThrow(
			calendarSourcesRecipe().decode({
				data: { calendarSources: rowsResult([stored], { ...pageInfo, hasMore: false }) },
			}),
		);
		expect(decoded).toEqual([source]);
	});

	it("bounds date sources by UTC calendar dates and instant sources by the local window", () => {
		const dateQuery = occurrenceQuery({ source, window });
		const start = startsAt;
		expect(dateQuery.where).toEqual({
			type: "and",
			predicates: [
				source.query.where,
				expect.objectContaining({ type: "or" }),
				gte(start, castDate(literal("2026-03-01T00:00:00.000Z"))),
				lt(start, castDate(literal("2026-04-01T00:00:00.000Z"))),
			],
		});
		expect(
			occurrenceQuery({ source, window: { ...window, month: "2026-12" } }).where,
		).toMatchObject({
			predicates: [
				{},
				{},
				gte(start, castDate(literal("2026-12-01T00:00:00.000Z"))),
				lt(start, castDate(literal("2027-01-01T00:00:00.000Z"))),
			],
		});
		const instantQuery = occurrenceQuery({ window, source: { ...source, precision: "instant" } });
		expect(instantQuery.where).toMatchObject({
			predicates: [
				{},
				{},
				gte(start, castDate(literal(window.localStart))),
				lt(start, castDate(literal(window.localEnd))),
			],
		});
	});

	it("names its query independently of the source and selects subject provenance", () => {
		const query = occurrenceQuery({ source, window, after: "cursor" });
		expect(Object.keys(occurrences({ source, window }).document.queries)).toEqual([
			"calendarOccurrences",
		]);
		expect(query.output.pagination).toEqual({ limit: 100, after: "cursor" });
		expect(query.output.orderBy).toEqual([{ expr: startsAt, direction: "asc" }]);
		expect(
			query.output.fields.map((selection) => ("key" in selection ? selection.key : "")),
		).toEqual([
			"startsAt",
			"caption",
			"art",
			"done",
			"__calendarSubjectId",
			"__calendarSubjectName",
			"__calendarSubjectOwner",
			"__calendarSubjectSchema",
		]);
	});

	it("decodes occurrences with provenance, falling back to no art when it is malformed", () => {
		const recipe = occurrences({ source, window });
		const decoded = Result.getOrThrow(
			recipe.decode({
				data: {
					calendarOccurrences: rowsResult(
						[row, { ...row, done: null, caption: null, art: { url: "nope", type: "local" } }],
						pageInfo,
					),
				},
			}),
		);
		expect(decoded.pageInfo).toEqual({ hasMore: true, nextCursor: "next" });
		expect(decoded.items).toEqual([
			{
				done: true,
				precision: "date",
				caption: "Step 2",
				startAt: row.startsAt,
				sourceKey: source.sourceKey,
				art: { type: "local", key: "records/one.webp" },
				key: JSON.stringify(["record-1", row.startsAt, "Step 2"]),
				subject: { name: "Alpha", id: "record-1", owner: "plugin-1", schemaSlug: "record" },
			},
			{
				art: null,
				done: false,
				caption: null,
				precision: "date",
				startAt: row.startsAt,
				sourceKey: source.sourceKey,
				key: JSON.stringify(["record-1", row.startsAt, null]),
				subject: { name: "Alpha", id: "record-1", owner: "plugin-1", schemaSlug: "record" },
			},
		]);
		expect(
			Result.isFailure(
				recipe.decode({
					data: { calendarOccurrences: rowsResult([{ ...row, startsAt: null }], pageInfo) },
				}),
			),
		).toBe(true);
	});

	it("selects only the named fields a source declares", () => {
		const bare = { ...source, art: null, done: null, caption: null };
		const query = occurrenceQuery({ window, source: bare });
		expect(
			query.output.fields.map((selection) => ("key" in selection ? selection.key : "")),
		).toEqual([
			"startsAt",
			"__calendarSubjectId",
			"__calendarSubjectName",
			"__calendarSubjectOwner",
			"__calendarSubjectSchema",
		]);
		const decoded = Result.getOrThrow(
			occurrences({ window, source: bare }).decode({
				data: { calendarOccurrences: rowsResult([row], pageInfo) },
			}),
		);
		expect(decoded.items[0]).toMatchObject({ art: null, done: false, caption: null });
	});

	it("rejects a source whose start field is not projected", () => {
		expect(
			Result.isFailure(
				calendarOccurrencesPageRecipe({ window, source: { ...source, startAt: "x" } }),
			),
		).toBe(true);
	});
});
