import { expect } from "bun:test";

import { RyotQLBadRequest } from "@ryot-app/contract/modules/ryotql/contract";
import { RyotQLService } from "@ryot-app/kernel-backend/modules/ryotql/service";
import { DatabaseSession } from "@ryot-app/kernel-backend/platform/db/session";
import * as tables from "@ryot-app/kernel-backend/schema/tables/combined";
import { makeAppConfigLayer } from "@ryot-app/kernel-backend/testing/effect";
import { isolatedDatabaseLayer } from "@ryot-app/kernel-backend/testing/isolated-database";
import {
	and,
	column,
	eq,
	eventOrderDescending,
	literal,
	selectedField,
	selectedRows,
	table,
} from "@ryot-app/plugin-kit/ryotql";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer, Result, Schema } from "effect";

import { historyCategory, mediaEventHistoryRecipe } from "./history-recipes";
import { mediaEntityParameters } from "./query-parameters";

const categories = ["parent", "episode", "season", "collection"] as const;
const history = mediaEventHistoryRecipe(
	categories.map((kind) => {
		const event = table("event", `${kind}Event`);
		return historyCategory(
			selectedRows(event, {
				orderBy: eventOrderDescending(event),
				where: and(
					eq(column(event, "entityId"), mediaEntityParameters.value("entityId")),
					eq(column(event, "sessionEntityId"), literal(kind)),
				),
				selection: {
					id: selectedField(column(event, "id"), Schema.String),
					createdAt: selectedField(column(event, "createdAt"), Schema.String),
					occurredAt: selectedField(column(event, "occurredAt"), Schema.String),
				},
			}),
			(row) => ({ ...row, kind }),
		);
	}),
);
const occurredAt = new Date("2026-11-01T10:00:00Z");
const createdAt = new Date("2026-11-01T10:00:01Z");
const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db.insert(tables.user).values([
				{ id: "owner", name: "Owner", email: "history-owner@test.local" },
				{ id: "other", name: "Other", email: "history-other@test.local" },
			]);
			yield* db
				.insert(tables.entity)
				.values(
					["target", "changed", ...categories].map((id) => ({
						id,
						name: id,
						userId: "owner",
						entitySchemaSlug: "root",
					})),
				);
			yield* db.insert(tables.event).values(
				[
					{ id: "z", sessionEntityId: "parent" },
					{ id: "y", sessionEntityId: "episode" },
					{ id: "x", sessionEntityId: "collection" },
					{ id: "w", sessionEntityId: "season" },
					{ id: "v", sessionEntityId: "episode" },
					{ id: "u", sessionEntityId: "parent" },
				].map((event, index) => ({
					occurredAt,
					id: event.id,
					userId: "owner",
					entityId: "target",
					eventSchemaSlug: "occurrence",
					sessionEntityId: event.sessionEntityId,
					createdAt: index < 4 ? createdAt : occurredAt,
				})),
			);
			yield* db
				.insert(tables.event)
				.values({
					createdAt,
					occurredAt,
					id: "foreign",
					userId: "other",
					entityId: "target",
					sessionEntityId: "parent",
					eventSchemaSlug: "occurrence",
				});
		}),
	);
});
const database = Layer.merge(RyotQLService.layer, Layer.effectDiscard(seed)).pipe(
	Layer.provideMerge(isolatedDatabaseLayer("media_history")),
	Layer.provide(makeAppConfigLayer()),
);
layer(database)((test) => {
	test.effect(
		"pages interleaved categories at equal timestamps with no duplicates or omitted rows",
		() =>
			Effect.gen(function* () {
				const service = yield* RyotQLService;
				const items: string[] = [];
				let after: string | undefined;
				const kinds: string[] = [];
				for (let page = 0; page < 3; page++) {
					const response = yield* service.executeForUser("owner", null, "plugin", {
						arguments: { entityId: "target" },
						pages: { history: { after, limit: 2 } },
						source: { kind: "inline", document: history.document },
					});
					const result = Result.getOrThrow(history.decode(response));
					items.push(...result.items.map((row) => row.id));
					kinds.push(...result.items.map((row) => row.kind));
					expect(result.pageInfo.hasMore).toBe(page < 2);
					after = result.pageInfo.nextCursor ?? undefined;
				}
				expect(items).toEqual(["z", "y", "x", "w", "v", "u"]);
				expect(kinds).toEqual(["parent", "episode", "collection", "season", "episode", "parent"]);
				expect(new Set(items).size).toBe(items.length);
				expect(after).toBeUndefined();
			}),
	);
	test.effect("rejects invalid cursors and prevents rebinding a cursor to another entity", () =>
		Effect.gen(function* () {
			const service = yield* RyotQLService;
			const source = { kind: "inline", document: history.document } as const;
			assertExitFails(
				yield* Effect.exit(
					service.executeForUser("owner", null, "plugin", {
						source,
						arguments: { entityId: "target" },
						pages: { history: { limit: 2, after: "invalid" } },
					}),
				),
				new RyotQLBadRequest({ reason: { code: "invalid-cursor" } }),
			);
			const first = Result.getOrThrow(
				history.decode(
					yield* service.executeForUser("owner", null, "plugin", {
						source,
						pages: { history: { limit: 2 } },
						arguments: { entityId: "target" },
					}),
				),
			);
			const after = first.pageInfo.nextCursor;
			assert(after);
			assertExitFails(
				yield* Effect.exit(
					service.executeForUser("owner", null, "plugin", {
						source,
						arguments: { entityId: "changed" },
						pages: { history: { after, limit: 2 } },
					}),
				),
				new RyotQLBadRequest({ reason: { code: "invalid-cursor" } }),
			);
		}),
	);
});
