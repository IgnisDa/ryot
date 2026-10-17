import type {
	Filter,
	QueryFilterField,
	ValueFilterField,
} from "@ryot-app/contract/modules/filters/schemas";
import {
	EntitySchemaSlug,
	EventSchemaSlug,
	PluginId,
	RelationshipSchemaSlug,
} from "@ryot-app/contract/schema/brands";
import {
	and,
	castBoolean,
	castDate,
	castNumber,
	castText,
	column,
	contains,
	document,
	eq,
	eventSchemaPredicate,
	exists,
	field,
	gte,
	inArray,
	isNotNull,
	isNull,
	jsonArrayExists,
	jsonElement,
	jsonElementsJoin,
	join,
	jsonPath,
	literal,
	lte,
	not,
	or,
	relationshipSchemaPredicate,
	rows,
	table,
} from "@ryot-app/ryotql";
import { DateTime, Effect, Result } from "effect";
import { TestClock } from "effect/testing";
import { beforeAll, describe, expect, it } from "vitest";

import {
	activeRuleCount,
	compileFilter,
	decodeFilterParam,
	draftFromRule,
	draftRule,
	editableGroup,
	effectiveFilterFields,
	encodeFilterParam,
	filterOperatorsFor,
	groupFilter,
	linkedFilterChoicesInput,
	linkedFilterChoicesRecipe,
	newFilterDraft,
} from "./filters";
import { entityBrowserCountRecipe, entityBrowserRecipe, resultsTableRecipe } from "./saved-views";
import { requireRowsQuery } from "./test-utils";

const entity = table("entity", "entity");
const properties = column(entity, "properties");
const subject = {
	entityAlias: "entity",
	schemas: [{ owner: { kind: "kernel" }, slug: EntitySchemaSlug.make("book") }],
} as const;

const source = requireRowsQuery(
	document({
		selection: rows(entity, {
			limit: 40,
			orderBy: [{ direction: "asc", expr: column(entity, "id") }],
			fields: [
				field("name", column(entity, "name")),
				field("level", jsonPath(properties, "level")),
				field("muscles", jsonPath(properties, "muscles")),
				field("genres", jsonPath(properties, "genres")),
				field("reps", jsonPath(properties, "reps")),
				field("done", jsonPath(properties, "done")),
				field("added", column(entity, "createdAt")),
			],
		}),
	}).queries.selection,
);

const valueField = (
	key: string,
	type: "enum" | "enum-list" | "text" | "text-list" | "number" | "date" | "boolean",
): ValueFilterField =>
	type === "enum" || type === "enum-list"
		? { key, type, label: key, field: key, kind: "value", choices: [{ value: "a", label: "A" }] }
		: { key, type, label: key, field: key, kind: "value" };

const sessionEventField: QueryFilterField = {
	key: "exercises",
	label: "Exercises",
	kind: "session-event",
	event: {
		owner: { kind: "kernel" },
		slug: EventSchemaSlug.make("workout-set"),
		entitySchemaSlug: EntitySchemaSlug.make("exercise"),
	},
};

const fields: readonly QueryFilterField[] = [
	valueField("name", "text"),
	valueField("level", "enum"),
	valueField("muscles", "enum-list"),
	valueField("genres", "text-list"),
	valueField("reps", "number"),
	valueField("done", "boolean"),
	valueField("added", "date"),
	sessionEventField,
	...effectiveFilterFields("entity-browser", {}),
];

let now: DateTime.Utc;

beforeAll(() =>
	Effect.runPromise(
		Effect.scoped(
			Effect.gen(function* () {
				const clock = yield* TestClock.make();
				yield* clock.setTime(Date.parse("2026-03-10T12:00:00.000Z"));
				now = DateTime.makeUnsafe(clock.currentTimeMillisUnsafe());
			}),
		),
	),
);

const compile = (filter: Filter, override: Partial<Parameters<typeof compileFilter>[0]> = {}) =>
	compileFilter({ now, source, fields, filter, subject, ...override });

const compiled = (filter: Filter) => Result.getOrThrow(compile(filter));

const effectiveCollections = () => {
	const collections = effectiveFilterFields("entity-browser", {}).find(
		({ key }) => key === "collections",
	);
	if (collections?.kind !== "relationship") {
		throw new Error("Expected the kernel collections field");
	}
	return collections;
};

const element = castText(jsonElement());
const text = (key: string) => castText(jsonPath(properties, key));

const linked = (alias: string, ids: readonly string[]) => {
	const rel = table("relationship", alias);
	return exists(rel, {
		where: and(
			relationshipSchemaPredicate(rel, "member-of", { kind: "kernel" }),
			eq(column(rel, "sourceEntityId"), column(entity, "id")),
			...(ids.length === 0
				? []
				: [
						inArray(
							column(rel, "targetEntityId"),
							ids.map((id) => literal(id)),
						),
					]),
		),
	});
};

const logged = (alias: string, entityAlias: string, ids: readonly string[]) => {
	const event = table("event", alias);
	const logEntity = table("entity", entityAlias);
	return exists(event, {
		joins: [join("inner", logEntity, eq(column(logEntity, "id"), column(event, "entityId")))],
		where: and(
			eventSchemaPredicate(event, logEntity, "exercise", "workout-set", { kind: "kernel" }),
			eq(column(event, "sessionEntityId"), column(entity, "id")),
			...(ids.length === 0
				? []
				: [
						inArray(
							column(event, "entityId"),
							ids.map((id) => literal(id)),
						),
					]),
		),
	});
};

describe("filter compiler", () => {
	it("casts scalar operands to the kind of their literals", () => {
		const level = jsonPath(properties, "level");
		expect(compiled({ field: "level", operator: "anyOf", values: ["a", "b"] })).toEqual(
			inArray(text("level"), [literal("a"), literal("b")]),
		);
		expect(compiled({ values: ["a"], field: "level", operator: "noneOf" })).toEqual(
			or(isNull(level), not(inArray(text("level"), [literal("a")]))),
		);
		expect(compiled({ field: "level", operator: "empty" })).toEqual(isNull(level));
		expect(compiled({ field: "level", operator: "notEmpty" })).toEqual(isNotNull(level));
		expect(compiled({ value: "sq", field: "name", operator: "contains" })).toEqual(
			contains(castText(column(entity, "name")), literal("sq")),
		);
		expect(compiled({ field: "name", operator: "is", value: "Squat" })).toEqual(
			eq(castText(column(entity, "name")), literal("Squat")),
		);
		expect(compiled({ min: 3, max: 8, field: "reps", operator: "between" })).toEqual(
			and(
				gte(castNumber(jsonPath(properties, "reps")), literal(3)),
				lte(castNumber(jsonPath(properties, "reps")), literal(8)),
			),
		);
		expect(compiled({ field: "done", operator: "isFalse" })).toEqual(
			eq(castBoolean(jsonPath(properties, "done")), literal(false)),
		);
		expect(
			compiled({ field: "added", to: "2026-02-01", from: "2026-01-01", operator: "betweenDates" }),
		).toEqual(
			and(
				gte(castDate(column(entity, "createdAt")), castDate(literal("2026-01-01"))),
				lte(castDate(column(entity, "createdAt")), castDate(literal("2026-02-01"))),
			),
		);
	});

	it("derives withinLastDays from the supplied now", () => {
		expect(compiled({ days: 7, field: "added", operator: "withinLastDays" })).toEqual(
			gte(castDate(column(entity, "createdAt")), castDate(literal("2026-03-03T12:00:00.000Z"))),
		);
	});

	it("matches list fields element-wise and includes nulls for noneOf and empty", () => {
		const muscles = jsonPath(properties, "muscles");
		expect(compiled({ field: "muscles", operator: "anyOf", values: ["a", "b"] })).toEqual(
			jsonArrayExists(muscles, inArray(element, [literal("a"), literal("b")])),
		);
		expect(compiled({ field: "muscles", operator: "allOf", values: ["a", "b"] })).toEqual(
			and(
				jsonArrayExists(muscles, eq(element, literal("a"))),
				jsonArrayExists(muscles, eq(element, literal("b"))),
			),
		);
		expect(compiled({ values: ["a"], field: "muscles", operator: "noneOf" })).toEqual(
			not(jsonArrayExists(muscles, inArray(element, [literal("a")]))),
		);
		expect(compiled({ field: "muscles", operator: "empty" })).toEqual(
			or(isNull(muscles), not(jsonArrayExists(muscles))),
		);
		expect(compiled({ field: "muscles", operator: "notEmpty" })).toEqual(jsonArrayExists(muscles));
		expect(compiled({ value: "dra", field: "genres", operator: "contains" })).toEqual(
			jsonArrayExists(jsonPath(properties, "genres"), contains(element, literal("dra"))),
		);
	});

	it("nests and, or and not and drops empty groups", () => {
		const level: Filter = { field: "level", operator: "empty" };
		const reps: Filter = { value: 5, field: "reps", operator: "eq" };
		expect(
			compiled({
				type: "and",
				filters: [
					level,
					{
						type: "or",
						filters: [
							{ type: "not", filter: reps },
							{ type: "and", filters: [] },
						],
					},
				],
			}),
		).toEqual(
			and(
				isNull(jsonPath(properties, "level")),
				or(not(eq(castNumber(jsonPath(properties, "reps")), literal(5)))),
			),
		);
		expect(Result.getOrThrow(compile({ type: "or", filters: [] }))).toBeUndefined();
		expect(
			Result.getOrThrow(compile({ type: "not", filter: { type: "and", filters: [] } })),
		).toBeUndefined();
	});

	it("compiles relationship fields to correlated exists on unused aliases", () => {
		expect(compiled({ operator: "anyOf", field: "collections", values: ["c1", "c2"] })).toEqual(
			linked("relationship", ["c1", "c2"]),
		);
		expect(compiled({ values: ["c1"], operator: "noneOf", field: "collections" })).toEqual(
			not(linked("relationship", ["c1"])),
		);
		expect(compiled({ field: "collections", operator: "notEmpty" })).toEqual(
			linked("relationship", []),
		);
		expect(compiled({ operator: "empty", field: "collections" })).toEqual(
			not(linked("relationship", [])),
		);
		expect(compiled({ operator: "allOf", field: "collections", values: ["c1", "c2"] })).toEqual(
			and(linked("relationship", ["c1"]), linked("_relationship", ["c2"])),
		);
		const crowded = requireRowsQuery({
			...source,
			joins: [
				{
					type: "left",
					on: eq(literal(1), literal(1)),
					table: table("relationship", "relationship"),
				},
			],
		});
		expect(
			Result.getOrThrow(
				compile({ values: ["c1"], operator: "anyOf", field: "collections" }, { source: crowded }),
			),
		).toEqual(linked("_relationship", ["c1"]));
		const incoming: QueryFilterField = {
			key: "parents",
			label: "Parents",
			kind: "relationship",
			direction: "incoming",
			relationship: effectiveCollections().relationship,
		};
		const result = Result.getOrThrow(
			compile({ field: "parents", operator: "notEmpty" }, { fields: [incoming] }),
		);
		expect(JSON.stringify(result)).toContain('"field":"targetEntityId"');
	});

	it("keeps correlated aliases clear of JSON elements join aliases", () => {
		const crowded = requireRowsQuery({
			...source,
			joins: [
				jsonElementsJoin("inner", "relationship", jsonPath(column(entity, "properties"), "items")),
			],
		});
		expect(
			Result.getOrThrow(
				compile({ values: ["c1"], operator: "anyOf", field: "collections" }, { source: crowded }),
			),
		).toEqual(linked("_relationship", ["c1"]));
	});

	it("compiles session-event rules through the joined event entity", () => {
		expect(compiled({ operator: "anyOf", field: "exercises", values: ["x1", "x2"] })).toEqual(
			logged("event", "eventEntity", ["x1", "x2"]),
		);
		expect(compiled({ values: ["x1"], operator: "noneOf", field: "exercises" })).toEqual(
			not(logged("event", "eventEntity", ["x1"])),
		);
		expect(compiled({ field: "exercises", operator: "notEmpty" })).toEqual(
			logged("event", "eventEntity", []),
		);
		expect(compiled({ operator: "empty", field: "exercises" })).toEqual(
			not(logged("event", "eventEntity", [])),
		);
		expect(compiled({ operator: "allOf", field: "exercises", values: ["x1", "x2"] })).toEqual(
			and(logged("event", "eventEntity", ["x1"]), logged("_event", "_eventEntity", ["x2"])),
		);
		expect(
			Result.isFailure(compile({ value: "a", field: "exercises", operator: "contains" })),
		).toBe(true);
		expect(
			Result.isFailure(
				compile({ field: "exercises", operator: "notEmpty" }, { subject: undefined }),
			),
		).toBe(true);
	});

	it("fails for unknown fields, disallowed operators and relationship fields without a subject", () => {
		for (const filter of [
			{ field: "missing", operator: "empty" },
			{ value: "a", field: "level", operator: "contains" },
			{ field: "genres", operator: "empty" },
			{ field: "done", operator: "empty" },
			{ value: "a", field: "collections", operator: "contains" },
			{ min: 9, max: 1, field: "reps", operator: "between" },
			{ type: "and", filters: [{ field: "missing", operator: "empty" }] },
		] satisfies Filter[]) {
			expect(Result.isFailure(compile(filter))).toBe(true);
		}
		expect(
			Result.isFailure(
				compile({ field: "collections", operator: "notEmpty" }, { subject: undefined }),
			),
		).toBe(true);
	});
});

describe("effective filter fields", () => {
	it("adds the kernel Collections field to entity and collection browsers only", () => {
		const authored = [valueField("level", "enum")];
		expect(effectiveFilterFields("entity-browser", { filterFields: authored })).toEqual([
			...authored,
			effectiveCollections(),
		]);
		expect(effectiveFilterFields("collection-browser", {}).map(({ key }) => key)).toEqual([
			"collections",
		]);
		expect(effectiveFilterFields("results-table", { filterFields: authored })).toEqual(authored);
		expect(
			effectiveFilterFields("results-table", {
				filterFields: [
					{
						key: "related",
						label: "Related",
						kind: "relationship",
						direction: "outgoing",
						relationship: {
							slug: RelationshipSchemaSlug.make("related-to"),
							owner: { kind: "plugin", pluginId: PluginId.make("plugin-1") },
						},
					},
				],
			}),
		).toEqual([
			{
				key: "related",
				label: "Related",
				kind: "relationship",
				direction: "outgoing",
				relationship: { slug: "related-to", owner: { kind: "local", pluginId: "plugin-1" } },
			},
		]);
		expect(effectiveCollections().relationship).toEqual({
			slug: "member-of",
			owner: { kind: "kernel" },
		});
	});
});

describe("filtered recipes", () => {
	const settings = {
		subject,
		pageSize: 5,
		addAction: null,
		sortChoices: [],
		layouts: ["grid"],
		tableColumns: null,
		defaultLayout: "grid",
		searchFields: ["name"],
		sourceName: "selection",
		filterFields: [valueField("level", "enum")],
	} as const;
	const queryDocument = document({
		selection: rows(entity, {
			limit: 40,
			orderBy: [{ direction: "asc", expr: column(entity, "id") }],
			fields: [
				field("name", column(entity, "name")),
				field("level", jsonPath(properties, "level")),
			],
		}),
	});
	const filter: Filter = {
		type: "and",
		filters: [
			{ values: ["a"], field: "level", operator: "anyOf" },
			{ values: ["c1"], operator: "anyOf", field: "collections" },
		],
	};

	it("applies the same predicate to pages and counts", () => {
		const input = { now, filter, settings, queryDocument, searchText: "x" };
		const page = Result.getOrThrow(entityBrowserRecipe(input)).document.queries.entityBrowser;
		const count = Result.getOrThrow(
			entityBrowserCountRecipe(queryDocument, settings, { now, filter, searchText: "x" }),
		).document.queries.entityBrowserCount;
		if (page?.output.type !== "rows" || count?.output.type !== "aggregate") {
			throw new Error("Expected rows and aggregate queries");
		}
		expect(count.where).toEqual(page.where);
		expect(JSON.stringify(page.where)).toContain('"type":"exists"');
	});

	it("rejects unknown filter fields for the browser and results-table recipes", () => {
		expect(
			Result.isFailure(
				entityBrowserRecipe({
					now,
					settings,
					queryDocument,
					filter: { field: "missing", operator: "empty" },
				}),
			),
		).toBe(true);
		const tableSettings = {
			pageSize: 5,
			entityLink: null,
			rowKeyFields: ["name"],
			sourceName: "selection",
			filterFields: settings.filterFields,
			columns: [{ label: "Name", field: "name", displayKind: "text" }],
		} as const;
		const filtered = Result.getOrThrow(
			resultsTableRecipe({
				now,
				queryDocument,
				settings: tableSettings,
				filter: { field: "level", operator: "empty" },
			}),
		).document.queries.resultsTable;
		expect(filtered?.where).toEqual(isNull(jsonPath(properties, "level")));
		expect(
			Result.isFailure(
				resultsTableRecipe({
					now,
					queryDocument,
					settings: tableSettings,
					filter: { field: "collections", operator: "notEmpty" },
				}),
			),
		).toBe(true);
	});
});

const encode = (node: unknown) => Buffer.from(JSON.stringify(node)).toString("base64url");

const find = (key: string) => {
	const found = fields.find((candidate) => candidate.key === key);
	if (!found) {
		throw new Error(`Missing field ${key}`);
	}
	return found;
};

describe("filter URL codec", () => {
	const group: Filter = {
		type: "and",
		filters: [
			{ values: ["a"], field: "level", operator: "anyOf" },
			{ min: 1, max: 5, field: "reps", operator: "between" },
		],
	};

	it("round-trips filters through a URL-safe string that never looks like JSON", () => {
		for (const filter of [
			group,
			{ field: "done", operator: "isTrue" } satisfies Filter,
			{ operator: "allOf", field: "exercises", values: ["x1", "x2"] } satisfies Filter,
		]) {
			const encoded = encodeFilterParam(filter);
			expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
			expect(encoded?.[0]).not.toBe("{");
			expect(encoded?.[0]).not.toBe("[");
			expect(decodeFilterParam(encoded, fields)).toEqual(filter);
		}
		expect(encodeFilterParam(undefined)).toBeNull();
	});

	it("drops invalid leaves, empty groups and unreadable input", () => {
		const valid = { values: ["a"], field: "level", operator: "anyOf" };
		expect(decodeFilterParam(null, fields)).toBeUndefined();
		expect(decodeFilterParam("%%%", fields)).toBeUndefined();
		expect(
			decodeFilterParam(Buffer.from("not json").toString("base64url"), fields),
		).toBeUndefined();
		expect(decodeFilterParam(encode({ ...valid, field: "missing" }), fields)).toBeUndefined();
		expect(decodeFilterParam(encode({ ...valid, field: "reps" }), fields)).toBeUndefined();
		expect(decodeFilterParam(encode({ ...valid, values: [] }), fields)).toBeUndefined();
		expect(
			decodeFilterParam(encode({ min: 5, max: 1, field: "reps", operator: "between" }), fields),
		).toBeUndefined();
		expect(decodeFilterParam(encode({ type: "or", filters: [] }), fields)).toBeUndefined();
		expect(
			decodeFilterParam(
				encode({
					type: "and",
					filters: [valid, { ...valid, field: "missing" }, { type: "not", filter: { x: 1 } }],
				}),
				fields,
			),
		).toEqual({ type: "and", filters: [valid] });
	});

	it("edits one flat group and treats anything else as a single custom filter", () => {
		expect(editableGroup(undefined)).toEqual({ rules: [], match: "all" });
		expect(editableGroup(group)).toEqual({
			match: "all",
			rules: group.type === "and" ? group.filters : [],
		});
		expect(editableGroup({ type: "or", filters: [{ field: "done", operator: "isTrue" }] })).toEqual(
			{ match: "any", rules: [{ field: "done", operator: "isTrue" }] },
		);
		const nested: Filter = {
			type: "and",
			filters: [
				{ field: "done", operator: "isTrue" },
				{ type: "or", filters: [group] },
			],
		};
		expect(editableGroup(nested)).toBeNull();
		expect(editableGroup({ type: "not", filter: group })).toBeNull();
		expect(activeRuleCount(undefined)).toBe(0);
		expect(activeRuleCount(group)).toBe(2);
		expect(activeRuleCount(nested)).toBe(1);
		expect(groupFilter({ rules: [], match: "any" })).toBeUndefined();
		expect(groupFilter({ match: "any", rules: [{ field: "done", operator: "isTrue" }] })).toEqual({
			field: "done",
			operator: "isTrue",
		});
		expect(
			groupFilter({
				match: "any",
				rules: group.type === "and" ? group.filters.filter((child) => "field" in child) : [],
			}),
		).toMatchObject({ type: "or" });
	});

	it("lists the operators of each field kind", () => {
		expect(filterOperatorsFor(find("level"))).toEqual(["anyOf", "noneOf", "empty", "notEmpty"]);
		expect(filterOperatorsFor(find("collections"))).toContain("allOf");
		expect(newFilterDraft(find("reps")).operator).toBe("gte");
	});

	it("turns drafts into rules only once they are complete", () => {
		const level = fields.find(({ key }) => key === "level");
		if (!level) {
			throw new Error("Missing level field");
		}
		const draft = newFilterDraft(level);
		expect(draftRule(draft)).toBeUndefined();
		expect(draftRule({ ...draft, values: ["a"] })).toEqual({
			values: ["a"],
			field: "level",
			operator: "anyOf",
		});
		const between = {
			...draft,
			text: "2",
			second: "9",
			field: "reps",
			operator: "between",
		} as const;
		expect(draftRule(between)).toEqual({ min: 2, max: 9, field: "reps", operator: "between" });
		expect(draftRule({ ...between, second: "1" })).toBeUndefined();
		expect(draftRule({ ...between, text: "0", operator: "withinLastDays" })).toBeUndefined();
		for (const rule of [
			{ field: "added", to: "2026-02-01", from: "2026-01-01", operator: "betweenDates" },
			{ value: "x", field: "name", operator: "contains" },
			{ field: "done", operator: "isFalse" },
			{ days: 7, field: "added", operator: "withinLastDays" },
		] as const) {
			expect(draftRule(draftFromRule(rule))).toEqual(rule);
		}
	});
});

const choices = (
	linkField: Parameters<typeof linkedFilterChoicesInput>[0],
	input: { readonly searchText?: string; readonly ids?: readonly string[] } = {},
) => {
	const query = linkedFilterChoicesRecipe(linkedFilterChoicesInput(linkField, input)).document
		.queries["choices"];
	const output = query?.output;
	if (query === undefined || output?.type !== "aggregate") {
		throw new Error("Expected aggregate choices query");
	}
	return { ...query, output };
};

describe("linked filter choices recipe", () => {
	const relationship = effectiveCollections().relationship;
	const collections = (direction: "outgoing" | "incoming" = "outgoing") =>
		({
			direction,
			relationship,
			key: "collections",
			label: "Collections",
			kind: "relationship",
		}) as const;

	it("groups far-side entities by id and name ordered by name and limits the page", () => {
		const query = choices(collections());
		expect(query.output.groupBy?.map(({ key }) => key)).toEqual(["id", "name"]);
		expect(query.output.orderBy).toEqual([
			{ key: "name", direction: "asc" },
			{ key: "id", direction: "asc" },
		]);
		expect(query.output.limit).toBe(50);
		expect(JSON.stringify(query.joins)).toContain("targetEntityId");
		expect(JSON.stringify(choices(collections("incoming")).joins)).toContain("sourceEntityId");
	});

	it("narrows by search text and by explicit entity ids", () => {
		expect(JSON.stringify(choices(collections()).where)).not.toContain('"contains"');
		expect(JSON.stringify(choices(collections(), { searchText: " ab " }).where)).toContain(
			'"value":"ab"',
		);
		const byIds = JSON.stringify(choices(collections(), { ids: ["x1", "x2"] }).where);
		expect(byIds).toContain('"value":"x1"');
		expect(byIds).toContain('"value":"x2"');
	});

	it("lists session-event entities through the event schema identity", () => {
		const query = choices(sessionEventField, { searchText: "bench" });
		expect(JSON.stringify(query.joins)).toContain('"entityId"');
		const where = JSON.stringify(query.where);
		expect(where).toContain('"value":"workout-set"');
		expect(where).toContain('"value":"exercise"');
		expect(where).toContain('"value":"bench"');
		expect(where).toContain("sessionEntityId");
	});
});
