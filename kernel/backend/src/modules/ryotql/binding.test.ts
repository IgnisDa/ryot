import { assert, expect, it } from "@effect/vitest";
import { PluginId, PluginPackageId, PluginRevisionId } from "@ryot-app/contract/schema/brands";
import {
	aggregate,
	and,
	ascending,
	castDate,
	coalesce,
	column,
	conditional,
	countDistinct,
	eq,
	exists,
	field,
	first,
	inArray,
	include,
	join,
	jsonArrayCount,
	jsonArrayExists,
	jsonArrayFirst,
	jsonElementsJoin,
	jsonPath,
	literal,
	measure,
	pluginId,
	rows,
	star,
	table,
	timeSeries,
} from "@ryot-app/ryotql";
import { Effect } from "effect";

import { bindRyotQLDocument, pluginIdentityReferences } from "./binding";
import { validateRyotQLDocument } from "./validator";

const countMatchingValues = (value: unknown, key: string, expected: string): number => {
	if (Array.isArray(value)) {
		return value.reduce((count, item) => count + countMatchingValues(item, key, expected), 0);
	}
	if (typeof value !== "object" || value === null) {
		return 0;
	}
	return Object.entries(value).reduce((count, [entryKey, entryValue]) => {
		const match = entryKey === key && entryValue === expected ? 1 : 0;
		return count + match + countMatchingValues(entryValue, key, expected);
	}, 0);
};

const packageId = PluginPackageId.make("test/binding");
const user = {
	type: "user",
	language: null,
	userId: "owner",
	audience: "plugin",
	accessClass: "standard",
} as const;
const root = table("entity", "root");
const local = { kind: "local", pluginId: PluginId.make("private-a") } as const;
const catalog = [
	{ packageId, scope: "user", pluginId: "private-a" },
	{ packageId, scope: "system", pluginId: "system-a" },
] as const;

it.effect("binds package and self references without widening expanded selections", () =>
	Effect.gen(function* () {
		const nested = table("entity", "nested");
		const owner = pluginId({ packageId, scope: "user", kind: "package" });
		const self = pluginId({ kind: "self" });
		const validated = validateRyotQLDocument(
			{
				queries: {
					rows: rows(root, {
						fields: [star(root), field("owner", owner)],
						include: [
							include(nested, {
								limit: 1,
								key: "nested",
								orderBy: [ascending(column(nested, "id"))],
								fields: [star(nested), field("self", self)],
								where: eq(column(nested, "entitySchemaPluginId"), self),
							}),
						],
					}),
				},
			},
			user,
		);
		assert(validated.error === null);
		const bound = yield* bindRyotQLDocument(
			validated.value,
			{
				...user,
				definitionContext: {
					pluginId: local.pluginId,
					pluginRevisionId: PluginRevisionId.make("pinned"),
				},
			},
			catalog,
		);
		const query = bound.queries["rows"];
		const original = validated.value.queries["rows"];
		assert(query?.output.type === "rows");
		assert(original?.output.type === "rows");
		expect(query.output.fields.map(({ key }) => key)).toEqual(
			original.output.fields.map(({ key }) => key),
		);
		expect(query.output.fields.at(-1)).toEqual(field("owner", pluginId(local)));
		expect(query.output.include?.[0].fields.at(-1)).toEqual(field("self", pluginId(local)));
		expect(query.output.include?.[0].fields.map(({ expr }) => expr.type)).toEqual(
			original.output.include?.[0].fields.map(({ expr }) => expr.type),
		);
		expect(query.output.include?.[0].where).toEqual(
			eq(column(nested, "entitySchemaPluginId"), pluginId(local)),
		);
		expect(pluginIdentityReferences(validated.value)).toEqual([
			{ packageId, scope: "user", kind: "package" },
			{ kind: "self" },
		]);
	}),
);

it.effect(
	"binds package identities in all query expression locations without changing literals",
	() =>
		Effect.gen(function* () {
			const owner = pluginId({ packageId, scope: "user", kind: "package" });
			const nested = table("entity", "nested");
			const joined = table("entity", "joined");
			const nestedQuery = {
				where: eq(owner, column(nested, "entitySchemaPluginId")),
				joins: [join("inner", joined, eq(owner, column(joined, "entitySchemaPluginId")))],
			};
			const document = {
				queries: {
					aggregate: aggregate(root, {
						where: eq(owner, owner),
						groupBy: [field("owner", owner)],
						measures: [measure("owners", { expr: owner, function: "countDistinct" })],
					}),
					time: timeSeries(root, {
						bucket: "day",
						time: castDate(owner),
						where: eq(owner, owner),
						endAt: "2026-01-02T00:00:00Z",
						startAt: "2026-01-01T00:00:00Z",
						measure: { expr: owner, function: "minimum" },
					}),
					rows: rows(root, {
						orderBy: [ascending(owner)],
						joins: [join("left", joined, eq(owner, column(joined, "entitySchemaPluginId")))],
						where: and(eq(owner, column(root, "entitySchemaPluginId")), inArray(owner, [owner])),
						include: [
							include(nested, {
								...nestedQuery,
								limit: 1,
								key: "nested",
								orderBy: [ascending(owner)],
								fields: [field("owner", owner)],
								include: [
									include(table("entity", "child"), {
										limit: 1,
										key: "child",
										where: eq(owner, owner),
										orderBy: [ascending(owner)],
										fields: [field("owner", owner)],
									}),
								],
							}),
						],
						fields: [
							field("owner", owner),
							field(
								"ordinary",
								literal({
									type: "pluginId",
									reference: { packageId, scope: "user", kind: "package" },
								}),
							),
							field(
								"first",
								first(nested, { ...nestedQuery, select: owner, orderBy: [ascending(owner)] }),
							),
							field("exists", exists(nested, nestedQuery)),
							field("count", countDistinct(nested, owner, nestedQuery)),
							field("conditional", conditional(eq(owner, owner), coalesce(owner, owner), owner)),
							field("jsonExists", jsonArrayExists(jsonPath(owner, "items"), eq(owner, owner))),
							field("jsonCount", jsonArrayCount(owner, eq(owner, owner))),
							field(
								"jsonFirst",
								jsonArrayFirst(owner, {
									select: owner,
									where: eq(owner, owner),
									orderBy: [ascending(owner)],
								}),
							),
						],
					}),
				},
			};
			const bound = yield* bindRyotQLDocument(document, user, catalog);
			const ordinary = document.queries.rows.output.fields[1];
			expect(
				bound.queries["rows"]?.output.type === "rows" && bound.queries["rows"].output.fields[1],
			).toEqual(ordinary);
			expect(countMatchingValues(bound, "kind", "package")).toBe(1);
			expect(countMatchingValues(bound, "pluginId", "private-a")).toBeGreaterThan(30);
			expect(countMatchingValues(document, "pluginId", "private-a")).toBe(0);
		}),
);

it.effect(
	"binds self only from a trusted definition context and preserves explicit package scope",
	() =>
		Effect.gen(function* () {
			const document = {
				queries: {
					rows: rows(root, {
						fields: [
							field("self", pluginId({ kind: "self" })),
							field("system", pluginId({ packageId, kind: "package", scope: "system" })),
							field("local", pluginId(local)),
						],
					}),
				},
			};
			const bound = yield* bindRyotQLDocument(
				document,
				{
					...user,
					definitionContext: {
						pluginId: local.pluginId,
						pluginRevisionId: PluginRevisionId.make("a-v1"),
					},
				},
				catalog,
			);
			expect(bound.queries["rows"]?.output).toMatchObject({
				fields: [
					{ expr: { type: "pluginId", reference: local } },
					{ expr: { type: "pluginId", reference: { kind: "local", pluginId: "system-a" } } },
					{ expr: { type: "pluginId", reference: local } },
				],
			});
			expect(
				yield* bindRyotQLDocument(
					{
						queries: { rows: rows(root, { fields: [field("self", pluginId({ kind: "self" }))] }) },
					},
					{
						...user,
						definitionContext: {
							pluginId: local.pluginId,
							pluginRevisionId: PluginRevisionId.make("bootstrap-v1"),
						},
					},
					[],
				),
			).toMatchObject({
				queries: {
					rows: { output: { fields: [{ expr: { type: "pluginId", reference: local } }] } },
				},
			});
			expect(yield* Effect.flip(bindRyotQLDocument(document, user, catalog))).toMatchObject({
				reason: {
					issue: "self-unbound",
					reference: { kind: "self" },
					code: "unresolved-query-owner",
				},
			});
		}),
);

it.effect(
	"diagnoses missing package identities and scope mismatches without resolving alternate packages",
	() =>
		Effect.gen(function* () {
			const privateReference = { packageId, scope: "user", kind: "package" } as const;
			const document = {
				queries: { rows: rows(root, { fields: [field("owner", pluginId(privateReference))] }) },
			};
			expect(
				yield* Effect.flip(bindRyotQLDocument(document, { type: "admin" }, catalog)),
			).toMatchObject({
				reason: {
					issue: "wrong-scope",
					reference: privateReference,
					code: "unresolved-query-owner",
				},
			});
			expect(yield* Effect.flip(bindRyotQLDocument(document, user, [catalog[1]]))).toMatchObject({
				reason: {
					issue: "wrong-scope",
					reference: privateReference,
					code: "unresolved-query-owner",
				},
			});
			const systemReference = pluginId({ packageId, kind: "package", scope: "system" }).reference;
			const systemDocument = {
				queries: { rows: rows(root, { fields: [field("owner", pluginId(systemReference))] }) },
			};
			expect(
				yield* Effect.flip(bindRyotQLDocument(systemDocument, user, [catalog[0]])),
			).toMatchObject({
				reason: {
					issue: "wrong-scope",
					reference: systemReference,
					code: "unresolved-query-owner",
				},
			});
			const unknownReference = pluginId({
				scope: "system",
				kind: "package",
				packageId: PluginPackageId.make("test/other-binding"),
			}).reference;
			const unknownDocument = {
				queries: { rows: rows(root, { fields: [field("owner", pluginId(unknownReference))] }) },
			};
			expect(
				yield* Effect.flip(bindRyotQLDocument(unknownDocument, user, [catalog[0]])),
			).toMatchObject({
				reason: { issue: "missing", reference: unknownReference, code: "unresolved-query-owner" },
			});
			const exact = {
				queries: { rows: rows(root, { fields: [field("owner", pluginId(local))] }) },
			};
			expect(yield* Effect.flip(bindRyotQLDocument(exact, user, [catalog[1]]))).toMatchObject({
				reason: { reference: local, issue: "unavailable", code: "unresolved-query-owner" },
			});
			expect(yield* bindRyotQLDocument(exact, { type: "admin" }, catalog)).toEqual(exact);
		}),
);

it.effect("binds self inside JSON elements join expressions", () =>
	Effect.gen(function* () {
		const self = pluginId({ kind: "self" });
		const document = {
			queries: {
				rows: rows(root, {
					fields: [],
					joins: [
						jsonElementsJoin(
							"inner",
							"element",
							conditional(
								eq(self, column(root, "entitySchemaPluginId")),
								jsonPath(column(root, "properties"), "items"),
								literal(null),
							),
						),
					],
				}),
			},
		};
		const bound = yield* bindRyotQLDocument(
			document,
			{
				...user,
				definitionContext: {
					pluginId: local.pluginId,
					pluginRevisionId: PluginRevisionId.make("a-v1"),
				},
			},
			catalog,
		);
		expect(bound.queries["rows"]?.joins).toMatchObject([
			{ expr: { condition: { left: { type: "pluginId", reference: local } } } },
		]);
		expect(pluginIdentityReferences(bound)).toEqual([local]);
		expect(yield* Effect.flip(bindRyotQLDocument(document, user, catalog))).toMatchObject({
			reason: {
				issue: "self-unbound",
				reference: { kind: "self" },
				code: "unresolved-query-owner",
			},
		});
	}),
);
