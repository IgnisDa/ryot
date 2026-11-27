import { expect } from "bun:test";

import { PluginId, PluginPackageId, PluginRevisionId } from "@ryot-app/contract/schema/brands";
import {
	aggregate,
	and,
	ascending,
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
} from "@ryot-app/ryotql";
import {
	executableFieldsFixture,
	executableFixture,
	executablePredicateFixture,
	validateAuthoredFixture,
} from "@ryot-app/ryotql/fixture.test-support";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { isUnknownArray } from "@ryot-app/ts-utils/predicates";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { bindRyotQLDocument, pluginIdentityReferences } from "./binding";

const countMatchingValues = (value: unknown, key: string, expected: string): number => {
	if (isUnknownArray(value)) {
		return value.reduce<number>(
			(count, item) => count + countMatchingValues(item, key, expected),
			0,
		);
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

it.effect(
	"binds package and self references without widening expanded selections",
	() =>
		Effect.gen(function* () {
			const nested = table("entity", "nested");
			const owner = pluginId({ packageId, scope: "user", kind: "package" });
			const self = pluginId({ kind: "self" });
			const validated = validateAuthoredFixture(
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
			expect(query.output.fields.at(-1)).toEqual(
				executableFieldsFixture([field("owner", pluginId(local))])[0],
			);
			expect(query.output.include?.[0].fields.at(-1)).toEqual(
				executableFieldsFixture([field("self", pluginId(local))])[0],
			);
			expect(query.output.include?.[0].fields.map(({ expr }) => expr.type)).toEqual(
				original.output.include?.[0].fields.map(({ expr }) => expr.type),
			);
			expect(query.output.include?.[0].where).toEqual(
				executablePredicateFixture(eq(column(nested, "entitySchemaPluginId"), pluginId(local))),
			);
			expect(pluginIdentityReferences(validated.value)).toEqual([
				{ packageId, scope: "user", kind: "package" },
				{ kind: "self" },
			]);
		}),
	testTimeout,
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
			const bound = yield* bindRyotQLDocument(executableFixture(document), user, catalog);
			const original = executableFixture(document).queries["rows"];
			assert(original?.output.type === "rows");
			const ordinary = original.output.fields[1];
			expect(
				bound.queries["rows"]?.output.type === "rows" && bound.queries["rows"].output.fields[1],
			).toEqual(ordinary);
			expect(countMatchingValues(bound, "kind", "package")).toBe(1);
			expect(countMatchingValues(bound, "pluginId", "private-a")).toBeGreaterThan(30);
			expect(countMatchingValues(document, "pluginId", "private-a")).toBe(0);
		}),
	testTimeout,
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
				executableFixture(document),
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
					executableFixture({
						queries: { rows: rows(root, { fields: [field("self", pluginId({ kind: "self" }))] }) },
					}),
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
			expect(
				yield* Effect.flip(bindRyotQLDocument(executableFixture(document), user, catalog)),
			).toMatchObject({
				reason: {
					issue: "self-unbound",
					reference: { kind: "self" },
					code: "unresolved-query-owner",
				},
			});
		}),
	testTimeout,
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
				yield* Effect.flip(
					bindRyotQLDocument(executableFixture(document), { type: "admin" }, catalog),
				),
			).toMatchObject({
				reason: {
					issue: "wrong-scope",
					reference: privateReference,
					code: "unresolved-query-owner",
				},
			});
			expect(
				yield* Effect.flip(bindRyotQLDocument(executableFixture(document), user, [catalog[1]])),
			).toMatchObject({
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
				yield* Effect.flip(
					bindRyotQLDocument(executableFixture(systemDocument), user, [catalog[0]]),
				),
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
				yield* Effect.flip(
					bindRyotQLDocument(executableFixture(unknownDocument), user, [catalog[0]]),
				),
			).toMatchObject({
				reason: { issue: "missing", reference: unknownReference, code: "unresolved-query-owner" },
			});
			const exact = {
				queries: { rows: rows(root, { fields: [field("owner", pluginId(local))] }) },
			};
			expect(
				yield* Effect.flip(bindRyotQLDocument(executableFixture(exact), user, [catalog[1]])),
			).toMatchObject({
				reason: { reference: local, issue: "unavailable", code: "unresolved-query-owner" },
			});
			expect(
				yield* bindRyotQLDocument(executableFixture(exact), { type: "admin" }, catalog),
			).toEqual(executableFixture(exact));
		}),
	testTimeout,
);

it.effect(
	"binds self inside JSON elements join expressions",
	() =>
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
				executableFixture(document),
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
			expect(
				yield* Effect.flip(bindRyotQLDocument(executableFixture(document), user, catalog)),
			).toMatchObject({
				reason: {
					issue: "self-unbound",
					reference: { kind: "self" },
					code: "unresolved-query-owner",
				},
			});
		}),
	testTimeout,
);
