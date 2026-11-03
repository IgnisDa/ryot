import { assert, expect, layer } from "@effect/vitest";
import type { NamedQuery } from "@ryot-app/contract/modules/ryotql/language";
import {
	ascending,
	column,
	count,
	eq,
	exists,
	field,
	join,
	literal,
	rows,
	table,
} from "@ryot-app/ryotql";
import { Effect, Layer } from "effect";

import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";
import { isolatedDatabaseLayer } from "#testing/isolated-database";

import { RyotQLService } from "./service";

const subject = table("entity", "subject");
const source = table("event", "source");
const linked = table("event", "linked");
const ofSubject = { where: eq(column(source, "entityId"), column(subject, "id")) };
const occurredAt = new Date("2026-01-15");
const eventCounts: Readonly<Record<string, number>> = { a: 3, b: 1, c: 0, d: 2, e: 1 };

const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db
				.insert(tables.user)
				.values([{ id: "owner", name: "Owner", email: "owner@example.test" }]);
			yield* db
				.insert(tables.entity)
				.values(
					Object.keys(eventCounts).map((id) => ({
						id,
						name: id,
						userId: "owner",
						entitySchemaSlug: "root",
					})),
				);
			yield* db
				.insert(tables.event)
				.values(
					Object.entries(eventCounts).flatMap(([entityId, total]) =>
						Array.from({ length: total }, (_, index) => ({
							entityId,
							occurredAt,
							userId: "owner",
							sessionEntityId: "a",
							id: `${entityId}-${index}`,
							eventSchemaSlug: "occurrence",
						})),
					),
				);
		}),
	);
});

const databaseLayer = Layer.merge(RyotQLService.layer, Layer.effectDiscard(seed)).pipe(
	Layer.provideMerge(isolatedDatabaseLayer("ryotql_rows_page")),
);

const allPages = Effect.fn(function* (query: (after: string | undefined) => NamedQuery) {
	const service = yield* RyotQLService;
	const pages: unknown[][] = [];
	let after: string | undefined;
	do {
		const result = (yield* service.executeForUser("owner", null, "plugin", {
			queries: { rows: query(after) },
		})).data["rows"];
		assert(result?.type === "rows");
		pages.push([...result.items]);
		after = result.pageInfo.nextCursor ?? undefined;
	} while (after !== undefined);
	return pages;
});

const subjectFields = [
	field("id", column(subject, "id")),
	field("events", count(source, ofSubject)),
];

layer(databaseLayer)((test) => {
	test.effect("pages rows whose aggregates only their fields read", () =>
		Effect.gen(function* () {
			const pages = yield* allPages((after) =>
				rows(subject, {
					after,
					limit: 2,
					fields: subjectFields,
					orderBy: [ascending(column(subject, "name"))],
				}),
			);
			expect(pages).toEqual([
				[
					{ id: "a", events: 3 },
					{ id: "b", events: 1 },
				],
				[
					{ id: "c", events: 0 },
					{ id: "d", events: 2 },
				],
				[{ id: "e", events: 1 }],
			]);
		}),
	);

	test.effect("applies the filter before choosing the page", () =>
		Effect.gen(function* () {
			const pages = yield* allPages((after) =>
				rows(subject, {
					after,
					limit: 2,
					fields: subjectFields,
					where: exists(source, ofSubject),
					orderBy: [ascending(column(subject, "name"))],
				}),
			);
			expect(pages.flat()).toEqual([
				{ id: "a", events: 3 },
				{ id: "b", events: 1 },
				{ id: "d", events: 2 },
				{ id: "e", events: 1 },
			]);
		}),
	);

	test.effect("keeps every joined row when a page splits one root row", () =>
		Effect.gen(function* () {
			const pages = yield* allPages((after) =>
				rows(subject, {
					after,
					limit: 2,
					orderBy: [ascending(column(subject, "name"))],
					fields: [...subjectFields, field("linked", column(linked, "id"))],
					joins: [join("inner", linked, eq(column(linked, "entityId"), column(subject, "id")))],
				}),
			);
			expect(pages).toEqual([
				[
					{ id: "a", events: 3, linked: "a-0" },
					{ id: "a", events: 3, linked: "a-1" },
				],
				[
					{ id: "a", events: 3, linked: "a-2" },
					{ id: "b", events: 1, linked: "b-0" },
				],
				[
					{ id: "d", events: 2, linked: "d-0" },
					{ id: "d", events: 2, linked: "d-1" },
				],
				[{ id: "e", events: 1, linked: "e-0" }],
			]);
		}),
	);

	test.effect("runs a filter and order that read the aggregate over every row", () =>
		Effect.gen(function* () {
			const events = count(source, ofSubject);
			const pages = yield* allPages((after) =>
				rows(subject, {
					after,
					limit: 2,
					fields: subjectFields,
					orderBy: [ascending(events)],
					where: eq(events, literal(1)),
				}),
			);
			expect(pages.flat()).toEqual([
				{ id: "b", events: 1 },
				{ id: "e", events: 1 },
			]);
		}),
	);
});
