import { expect } from "bun:test";

import type { NamedQuery } from "@ryot-app/contract/modules/ryotql/authored";
import {
	and,
	ascending,
	castText,
	column,
	conditional,
	count,
	descending,
	eq,
	field,
	first,
	gt,
	inArray,
	isNotNull,
	isNull,
	jsonPath,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import { assert } from "@ryot-app/testing/assert";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { makeAppConfigLayer } from "#testing/effect";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { RyotQLService } from "./service";

const root = table("entity", "root");
const source = table("event", "source");
const scope = { where: eq(column(source, "entityId"), column(root, "id")) };
const latest = (select: Parameters<typeof first>[1]["select"]) =>
	first(source, {
		select,
		where: scope.where,
		orderBy: [descending(column(source, "occurredAt"))],
	});
const stored = castText(jsonPath(column(root, "properties"), "stored"));
const folded = isNotNull(stored);
const isRoot = eq(column(root, "entitySchemaSlug"), literal("root"));

const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db
				.insert(tables.user)
				.values({ id: "owner", name: "Owner", email: "owner@example.test" });
			yield* db.insert(tables.entity).values(
				[
					{ id: "a", properties: { stored: "kept" } },
					{ id: "b", properties: {} },
					{ id: "c", properties: {} },
					{ id: "d", properties: {} },
				].map(({ id, properties }) => ({
					id,
					name: id,
					properties,
					userId: "owner",
					entitySchemaSlug: "root",
				})),
			);
			yield* db.insert(tables.event).values(
				[
					{ day: 1, id: "a-1", slug: "w", entityId: "a" },
					{ day: 1, id: "b-1", slug: "x", entityId: "b" },
					{ day: 2, id: "b-2", slug: "y", entityId: "b" },
					{ day: 1, id: "c-1", slug: "z", entityId: "c" },
				].map(({ id, day, slug, entityId }) => ({
					id,
					entityId,
					userId: "owner",
					eventSchemaSlug: slug,
					occurredAt: new Date(Date.UTC(2026, 0, day)),
				})),
			);
		}),
	);
});

const databaseLayer = Layer.merge(RyotQLService.layer, Layer.effectDiscard(seed)).pipe(
	Layer.provideMerge(isolatedDatabaseLayer("ryotql_branch_reads")),
);

const execute = Effect.fn(function* (query: NamedQuery) {
	const service = yield* RyotQLService;
	const result = (yield* service.executeForUser("owner", null, "plugin", {
		source: { kind: "inline", document: { queries: { rows: query } } },
	})).data["rows"];
	assert(result?.type === "rows");
	return result.items;
});

layer(databaseLayer.pipe(Layer.provide(makeAppConfigLayer())))((test) => {
	test.effect(
		"reads a branch's laterals once per row in its filter, order and fields, only where the branch is taken",
		() =>
			Effect.gen(function* () {
				const value = conditional(folded, stored, latest(column(source, "eventSchemaSlug")));
				const events = conditional(folded, literal(-1), count(source, scope));
				const items = yield* execute(
					rows(root, {
						orderBy: [descending(value), ascending(events)],
						where: and(isRoot, inArray(value, [literal("kept"), literal("y"), literal("z")])),
						fields: [
							field("id", column(root, "id")),
							field("value", value),
							field("events", events),
						],
					}),
				);
				expect(items).toEqual([
					{ id: "c", events: 1, value: "z" },
					{ id: "b", events: 2, value: "y" },
					{ id: "a", events: -1, value: "kept" },
				]);
			}),
		testTimeout,
	);

	test.effect(
		"picks a page from a guarded lateral together with the lateral its guard reads",
		() =>
			Effect.gen(function* () {
				const untouched = isNull(latest(column(source, "id")));
				const items = yield* execute(
					rows(root, {
						orderBy: [ascending(column(root, "id"))],
						where: and(
							isRoot,
							gt(conditional(folded, literal(1), count(source, scope)), literal(0)),
						),
						fields: [
							field("id", column(root, "id")),
							field("latest", latest(column(source, "id"))),
							field("events", conditional(untouched, literal(0), count(source, scope))),
							field(
								"later",
								count(source, {
									where: and(scope.where, eq(column(source, "eventSchemaSlug"), literal("y"))),
								}),
							),
						],
					}),
				);
				expect(items).toEqual([
					{ id: "a", later: 0, events: 1, latest: "a-1" },
					{ id: "b", later: 1, events: 2, latest: "b-2" },
					{ id: "c", later: 0, events: 1, latest: "c-1" },
				]);
			}),
		testTimeout,
	);
});
