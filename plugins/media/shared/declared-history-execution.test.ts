import { expect } from "bun:test";

import { PluginId, PluginPackageId, PluginRevisionId } from "@ryot-app/contract/schema/brands";
import { RyotQLService } from "@ryot-app/kernel-backend/modules/ryotql/service";
import { DatabaseSession } from "@ryot-app/kernel-backend/platform/db/session";
import * as tables from "@ryot-app/kernel-backend/schema/tables/combined";
import { makeAppConfigLayer } from "@ryot-app/kernel-backend/testing/effect";
import { isolatedDatabaseLayer } from "@ryot-app/kernel-backend/testing/isolated-database";
import { assert } from "@ryot-app/testing/assert";
import { layer } from "@voila.dev/effect-bun-test";
import { Effect, Layer } from "effect";

import { mediaDeclaredQueries } from "../manifest/queries";

const eventIds = ["parent", "complete", "season", "progress", "review"];
const events = (
	[
		["show-parent", "show", "review", "2026-11-09T12:00:00Z"],
		["show-complete", "episode", "complete", "2026-11-08T12:00:00Z"],
		["show-season", "season", "review", "2026-11-07T12:00:00Z"],
		["show-progress", "episode", "progress", "2026-11-06T12:00:00Z"],
		["show-review", "episode", "review", "2026-11-05T12:00:00Z"],
		["podcast-parent", "podcast", "review", "2026-11-09T12:00:00Z"],
		["podcast-complete", "podcast-episode", "complete", "2026-11-08T12:00:00Z"],
		["podcast-progress", "podcast-episode", "progress", "2026-11-06T12:00:00Z"],
		["podcast-review", "podcast-episode", "review", "2026-11-05T12:00:00Z"],
		["unrelated", "other-episode", "complete", "2026-11-09T13:00:00Z"],
	] as const
).map(([id, entityId, eventSchemaSlug, at]) => ({
	id,
	entityId,
	properties: {},
	eventSchemaSlug,
	userId: "owner",
	occurredAt: new Date(at),
	eventSchemaPluginId: "media",
}));
const seed = Effect.gen(function* () {
	const session = yield* DatabaseSession;
	yield* session.run((db) =>
		Effect.gen(function* () {
			yield* db
				.insert(tables.user)
				.values({ id: "owner", name: "Owner", email: "declared-history@test.local" });
			yield* db
				.insert(tables.plugin)
				.values({ id: "media", status: "inactive", packageId: PluginPackageId.make("ryot/media") });
			yield* db.insert(tables.entity).values(
				(
					[
						["show", "show"],
						["season", "show-season"],
						["episode", "show-episode"],
						["podcast", "podcast"],
						["podcast-episode", "podcast-episode"],
						["other", "show"],
						["other-season", "show-season"],
						["other-episode", "show-episode"],
					] as const
				).map(([id, slug]) => ({
					id,
					name: id,
					userId: "owner",
					entitySchemaSlug: slug,
					entitySchemaPluginId: "media",
					properties: { seasonNumber: 1, episodeNumber: 1 },
				})),
			);
			yield* db.insert(tables.relationship).values(
				(
					[
						["show", "season", "show-to-show-season"],
						["season", "episode", "show-season-to-show-episode"],
						["podcast", "podcast-episode", "podcast-to-podcast-episode"],
						["other", "other-season", "show-to-show-season"],
						["other-season", "other-episode", "show-season-to-show-episode"],
					] as const
				).map(([sourceEntityId, targetEntityId, relationshipSchemaSlug], index) => ({
					sourceEntityId,
					targetEntityId,
					id: `r${index}`,
					userId: "owner",
					relationshipSchemaSlug,
					relationshipSchemaPluginId: "media",
				})),
			);
			yield* db.insert(tables.event).values(events);
		}),
	);
});
const database = Layer.merge(RyotQLService.layer, Layer.effectDiscard(seed)).pipe(
	Layer.provideMerge(isolatedDatabaseLayer("declared_history")),
	Layer.provide(makeAppConfigLayer()),
);
layer(database)((test) => {
	test.effect(
		"declared title history pages parent, season and episode events in global order",
		() =>
			Effect.gen(function* () {
				const service = yield* RyotQLService;
				for (const entityId of ["show", "podcast"]) {
					const ids: unknown[] = [];
					let after: string | undefined;
					do {
						const response = yield* service.executeForUser(
							"owner",
							null,
							"plugin",
							{
								arguments: { entityId },
								pages: { history: { after, limit: 2 } },
								source: {
									kind: "inline",
									document: mediaDeclaredQueries["title-history"].document,
								},
							},
							"standard",
							undefined,
							{
								pluginId: PluginId.make("media"),
								pluginRevisionId: PluginRevisionId.make("revision"),
							},
						);
						const history = response.data.history;
						assert(history?.type === "rows");
						for (const row of history.items) {
							assert(typeof row.category === "string");
							ids.push(row[`category${row.category}_id`]);
						}
						after = history.pageInfo.nextCursor ?? undefined;
					} while (after);
					expect(ids).toEqual(
						eventIds
							.filter((kind) => entityId === "show" || kind !== "season")
							.map((kind) => `${entityId}-${kind}`),
					);
				}
			}),
	);
});
