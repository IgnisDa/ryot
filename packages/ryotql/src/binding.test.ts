import { describe, expect, it } from "bun:test";

import type { Predicate, RyotQLDocument } from "@ryot-app/contract/modules/ryotql/authored";
import { RyotQLDocument as BoundDocument } from "@ryot-app/contract/modules/ryotql/language";
import type { ExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import { Result, Schema } from "effect";

import { dateAdd, filter, now, parameters, reportingTimeZone, sort } from "./authoring";
import {
	authoredValidationBranches,
	bindDocument,
	cursorBindingKey,
	validateAuthoredDocument,
} from "./binding";
import {
	aggregate,
	and,
	ascending,
	column,
	concat,
	dateBucket,
	document,
	eq,
	field,
	groupAscending,
	inArray,
	literal,
	measure,
	rows,
} from "./index";

const entity = { table: "entity", alias: "entity" };
const context = { reportingTimeZone: "UTC", now: new Date("2026-11-11T00:00:00Z") };
const declarations = parameters({
	fields: {
		search: { type: "string", label: "Search", description: "Search text" },
		source: {
			type: "string",
			label: "Source",
			description: "Entity source",
			defaultValue: "saved-selection",
			reference: { kind: "entity-source" },
		},
		ids: {
			label: "IDs",
			type: "array",
			defaultValue: [],
			description: "Entity IDs",
			items: { label: "ID", type: "string", description: "Entity ID" },
		},
		bucket: {
			type: "enum",
			label: "Bucket",
			defaultValue: "day",
			description: "Date bucket",
			choices: { kind: "static", values: [{ value: "day" }, { value: "month" }] },
		},
		mode: {
			type: "enum",
			label: "Mode",
			defaultValue: "first",
			description: "Selection mode",
			choices: { kind: "static", values: [{ value: "first" }, { value: "second" }] },
		},
	},
});
const build = (): RyotQLDocument => ({
	...document({
		items: rows(declarations.sourceEntity("source", "source"), {
			limit: 10,
			maxLimit: 50,
			orderBy: sort([ascending(column(entity, "id"))]),
			fields: [
				field("id", column(entity, "id")),
				field(
					"bucket",
					dateBucket(now(), { timeZone: reportingTimeZone, bucket: declarations.value("bucket") }),
				),
				field("since", dateAdd(now(), -12, "month")),
				field("literal", literal({ type: "parameter", name: "not-a-parameter" })),
			],
			where: and(
				declarations.whenSet("search", eq(column(entity, "name"), declarations.value("search"))),
				inArray(column(entity, "id"), declarations.list("ids")),
				declarations.choice("mode", {
					first: eq(column(entity, "kind"), literal("a")),
					second: eq(column(entity, "kind"), literal("b")),
				}),
				filter(),
			),
		}),
	}),
	parameters: declarations.schema,
	controls: { sort: { fields: [], kind: "outputs" }, filter: { fields: [], kind: "outputs" } },
});
const bindingContext = {
	...context,
	resolveSourceEntity: (reference: string, alias: string) =>
		Result.succeed({ alias, table: reference }),
};

describe("authored query binding", () => {
	it("binds defaults, lists, every placeholder kind, request controls and paging without mutating the document", () => {
		const authored = build();
		const before = JSON.stringify(authored);
		const result = Result.getOrThrow(
			bindDocument(
				authored,
				{
					sort: "name-desc",
					arguments: { ids: ["one"], mode: "second" },
					pages: { items: { limit: 25, after: "cursor" } },
					filter: { field: "name", operator: "is", value: "match" },
				},
				{
					...bindingContext,
					filter: () => Result.succeed(eq(column(entity, "name"), literal("match"))),
					sort: () => Result.succeed([{ direction: "desc", expr: column(entity, "name") }]),
				},
			),
		);
		expect(JSON.stringify(authored)).toBe(before);
		expect(Result.isSuccess(Schema.decodeResult(BoundDocument)(result.document))).toBe(true);
		expect(result.document.queries["items"]).toMatchObject({
			from: { alias: "source", table: "saved-selection" },
			where: {
				predicates: [
					{ type: "and", predicates: [] },
					{ type: "in", values: [{ value: "one", type: "literal" }] },
					{ right: { value: "b" } },
					{ right: { value: "match" } },
				],
			},
			output: {
				orderBy: [{ direction: "desc" }],
				pagination: { limit: 25, after: "cursor" },
				fields: [
					{ key: "id" },
					{
						key: "bucket",
						expr: {
							bucket: "day",
							timeZone: "UTC",
							expr: {
								type: "cast",
								target: "date",
								expr: { type: "literal", value: "2026-11-11T00:00:00.000Z" },
							},
						},
					},
					{ key: "since", expr: { amount: -12, unit: "month", type: "dateAdd" } },
					{
						key: "literal",
						expr: { type: "literal", value: { type: "parameter", name: "not-a-parameter" } },
					},
				],
			},
		});
		expect(result.arguments["bucket"]).toBe("day");
	});
	it("treats null as unset but preserves empty strings and false values as set", () => {
		for (const search of [null, "", "find"]) {
			const result = Result.getOrThrow(
				bindDocument(build(), { arguments: { search } }, bindingContext),
			);
			const predicate = result.document.queries["items"]?.where;
			expect(predicate?.type === "and" ? predicate.predicates[0] : undefined).toEqual<unknown>(
				search === null
					? { type: "and", predicates: [] }
					: eq(column(entity, "name"), literal(search)),
			);
		}
	});
	it("rejects missing bindings, unknown arguments, invalid pages and absent control resolution", () => {
		const authored = build();
		const invalid: readonly Omit<ExecutionRequest, "source">[] = [
			{ arguments: { missing: 1 } },
			{ pages: { unknown: {} } },
			{ pages: { items: { limit: 51 } } },
			{ pages: { items: { limit: 0 } } },
			{ sort: "name-desc" },
		];
		for (const values of invalid) {
			expect(Result.isFailure(bindDocument(authored, values, bindingContext))).toBe(true);
		}
		expect(Result.isFailure(bindDocument(authored, {}, context))).toBe(true);
	});
	it("validates every choice case and whenSet outcome before persisted validation", () => {
		const authored = build();
		const branches = Result.getOrThrow(
			authoredValidationBranches(authored, {
				...context,
				maximumBranches: 16,
				sourceEntity: (_, alias) => Result.succeed({ alias, table: "sourceEntity" }),
			}),
		);
		expect(branches).toHaveLength(4);
		expect(
			new Set(branches.map((branch) => JSON.stringify(branch.queries["items"]?.where))).size,
		).toBe(4);
		expect(
			Result.isFailure(
				authoredValidationBranches(authored, {
					...context,
					maximumBranches: 1,
					sourceEntity: (_, alias) => Result.succeed({ alias, table: "sourceEntity" }),
				}),
			),
		).toBe(true);
	});
	it("rejects undeclared parameters and malformed branches even when no request selects them", () => {
		const buildWhere = (where: Predicate): RyotQLDocument => ({
			...build(),
			queries: { items: rows(entity, { where, fields: [] }) },
		});
		const invalid: readonly Predicate[] = [
			eq(column(entity, "id"), { name: "missing", type: "parameter" }),
			eq(column(entity, "name"), declarations.value("search")),
			{ type: "whenSet", parameter: "mode", predicate: eq(literal(1), literal(1)) },
			{ type: "choice", parameter: "mode", cases: { first: eq(literal(1), literal(1)) } },
			{
				type: "choice",
				parameter: "mode",
				cases: {
					first: eq(literal(1), literal(1)),
					second: eq(literal(1), { name: "missing", type: "parameter" }),
				},
			},
		];
		for (const where of invalid) {
			expect(Result.isFailure(validateAuthoredDocument(buildWhere(where)))).toBe(true);
		}
	});
});

it("keeps cursor bindings stable across object ordering and separates argument, owner and source changes", () => {
	const identity = {
		ownerIdentity: "owner",
		sourceIdentity: "document-hash:query",
		arguments: { mode: "first", ids: ["one", "two"] },
	};
	const key = cursorBindingKey(identity);
	expect(
		cursorBindingKey({
			...identity,
			filter: undefined,
			arguments: { mode: "first", ids: ["one", "two"] },
		}),
	).toBe(key);
	for (const changed of [
		{ ...identity, ownerIdentity: "other" },
		{ ...identity, sourceIdentity: "other" },
		{ ...identity, arguments: { ...identity.arguments, mode: "second" } },
		{ ...identity, sort: "name-desc" },
	]) {
		expect(cursorBindingKey(changed)).not.toBe(key);
	}
});

it("binds scalar and ordering choices and numeric date offsets, and validates all their cases", () => {
	const input = parameters({
		fields: {
			amount: { type: "integer", label: "Offset", defaultValue: -1, description: "Date offset" },
			mode: {
				type: "enum",
				label: "Mode",
				defaultValue: "a",
				description: "Mode",
				choices: { kind: "static", values: [{ value: "a" }, { value: "b" }] },
			},
		},
	});
	const authored: RyotQLDocument = {
		parameters: input.schema,
		...document({
			items: rows(entity, {
				orderBy: input.choice("mode", {
					a: [ascending(column(entity, "id"))],
					b: [ascending(column(entity, "name"))],
				}),
				fields: [
					field(
						"value",
						input.choice("mode", {
							a: literal(1),
							b: dateAdd(now(), input.value("amount"), "day"),
						}),
					),
				],
			}),
		}),
	};
	expect(
		Result.getOrThrow(bindDocument(authored, { arguments: { mode: "b" } }, context)).document
			.queries["items"],
	).toMatchObject({
		output: {
			orderBy: [{ expr: { field: "name" } }],
			fields: [{ expr: { amount: -1, type: "dateAdd" } }],
		},
	});
	expect(
		Result.getOrThrow(
			authoredValidationBranches(authored, {
				...context,
				maximumBranches: 16,
				sourceEntity: (_, alias) => Result.succeed({ alias, table: "sourceEntity" }),
			}),
		),
	).toHaveLength(2);
});

it("distinguishes scalar parameters in expression arrays from whole-list parameters", () => {
	const input = parameters({
		fields: {
			id: { label: "ID", type: "string", description: "Entity ID", validation: { required: true } },
		},
	});
	const authored: RyotQLDocument = {
		parameters: input.schema,
		...document({
			items: rows(entity, {
				where: inArray(column(entity, "id"), [input.value("id")]),
				fields: [field("label", concat(literal("prefix"), input.value("id")))],
			}),
		}),
	};
	expect(
		Result.getOrThrow(bindDocument(authored, { arguments: { id: "one" } }, context)).document
			.queries["items"],
	).toMatchObject({
		where: { type: "in", values: [{ value: "one", type: "literal" }] },
		output: { fields: [{ expr: { values: [{ value: "prefix" }, { value: "one" }] } }] },
	});
});

it("pages grouped aggregates and rejects ungrouped pages and invalid stored maxima", () => {
	const grouped = aggregate(entity, {
		limit: 5,
		maxLimit: 10,
		orderBy: [groupAscending("name")],
		groupBy: [field("name", column(entity, "name"))],
		measures: [measure("count", { function: "count" })],
	});
	const authored = document({
		grouped,
		total: aggregate(entity, { measures: [measure("count", { function: "count" })] }),
	});
	expect(
		Result.getOrThrow(
			bindDocument(authored, { pages: { grouped: { limit: 8, after: "cursor" } } }, context),
		).document.queries["grouped"],
	).toMatchObject({ output: { limit: 8, after: "cursor" } });
	expect(Result.isFailure(bindDocument(authored, { pages: { total: {} } }, context))).toBe(true);
	expect(
		Result.isFailure(
			validateAuthoredDocument(
				document({ items: rows(entity, { limit: 10, fields: [], maxLimit: 5 }) }),
			),
		),
	).toBe(true);
});

it("keeps false boolean arguments set and validates parameter kinds at placeholder positions", () => {
	const input = parameters({
		fields: {
			flag: { label: "Flag", type: "boolean", description: "Optional flag" },
			amount: { type: "number", label: "Amount", defaultValue: 1, description: "Amount" },
			ids: {
				label: "IDs",
				type: "enum-array",
				description: "IDs",
				defaultValue: ["one"],
				choices: { kind: "static", values: [{ value: "one" }] },
			},
		},
	});
	const buildQuery = (where: Predicate): RyotQLDocument => ({
		parameters: input.schema,
		...document({ items: rows(entity, { where, fields: [] }) }),
	});
	const guarded = buildQuery(
		input.whenSet("flag", eq(column(entity, "flag"), input.value("flag"))),
	);
	expect(
		Result.getOrThrow(bindDocument(guarded, { arguments: { flag: false } }, context)).document
			.queries["items"],
	).toMatchObject({ where: { type: "comparison", right: { value: false } } });
	expect(
		Result.isFailure(
			validateAuthoredDocument(buildQuery(inArray(column(entity, "id"), input.value("amount")))),
		),
	).toBe(true);
	expect(
		Result.isFailure(
			validateAuthoredDocument(buildQuery(eq(column(entity, "id"), input.list("ids")))),
		),
	).toBe(true);
	expect(
		Result.isFailure(
			validateAuthoredDocument(
				buildQuery(eq(column(entity, "id"), { name: "toString", type: "parameter" })),
			),
		),
	).toBe(true);
});

it("preserves date parameter kinds in scalar and list positions and validation projections", () => {
	const input = parameters({
		fields: {
			at: { label: "At", type: "datetime", description: "Instant", validation: { required: true } },
			dates: {
				type: "array",
				label: "Dates",
				description: "Dates",
				defaultValue: ["2026-01-01"],
				items: { type: "date", label: "Date", description: "Date" },
			},
		},
	});
	const authored = {
		parameters: input.schema,
		...document({
			items: rows(entity, {
				where: inArray(column(entity, "createdAt"), input.list("dates")),
				fields: [field("day", dateBucket(input.value("at"), { bucket: "day", timeZone: "UTC" }))],
			}),
		}),
	};
	const bound = Result.getOrThrow(
		bindDocument(authored, { arguments: { at: "2026-01-01T12:00:00Z" } }, context),
	).document;
	expect(bound.queries["items"]).toMatchObject({
		output: { fields: [{ expr: { expr: { type: "cast", target: "date" } } }] },
		where: {
			values: [{ type: "cast", target: "date", expr: { type: "literal", value: "2026-01-01" } }],
		},
	});
	const branches = Result.getOrThrow(
		authoredValidationBranches(authored, {
			...context,
			maximumBranches: 8,
			sourceEntity: (_, alias) => Result.succeed({ alias, table: "sourceEntity" }),
		}),
	);
	expect(branches[0]?.queries["items"]).toMatchObject({
		output: { fields: [{ expr: { expr: { type: "cast", target: "date" } } }] },
	});
});

it("projects repeated correlated choices once per reachable assignment", () => {
	const repeated = declarations.choice("mode", {
		first: eq(column(entity, "name"), literal("first")),
		second: declarations.choice("bucket", {
			day: eq(column(entity, "name"), literal("day")),
			month: eq(column(entity, "name"), literal("month")),
		}),
	});
	const authored = {
		parameters: declarations.schema,
		...document({
			items: rows(entity, {
				fields: [field("id", column(entity, "id"))],
				where: and(...Array.from({ length: 80 }, () => repeated)),
			}),
		}),
	};
	const branches = Result.getOrThrow(
		authoredValidationBranches(authored, {
			...context,
			maximumBranches: 3,
			sourceEntity: (_, alias) => Result.succeed({ alias, table: "sourceEntity" }),
		}),
	);
	expect(branches).toHaveLength(3);
	expect(
		new Set(branches.map((branch) => JSON.stringify(branch.queries["items"]?.where))).size,
	).toBe(3);
	expect(
		Result.isFailure(
			authoredValidationBranches(authored, {
				...context,
				maximumBranches: 2,
				sourceEntity: (_, alias) => Result.succeed({ alias, table: "sourceEntity" }),
			}),
		),
	).toBe(true);
});
