import { expect, layer } from "@effect/vitest";
import { UserId } from "@ryot-app/contract/schema/brands";
import { eq, inArray, sql } from "drizzle-orm";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { assert } from "vitest";

import {
	installRevisionPackage,
	makeRevisionDatabaseLayer,
	revisionPackage,
} from "#modules/plugins/packages/revision.test-support";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import { EntityGraphCollector } from "./collector";
import { EntityRetentionRepository } from "./repository";

const testLayer = EntityGraphCollector.layer.pipe(
	Layer.provideMerge(EntityRetentionRepository.layer),
	Layer.provideMerge(makeRevisionDatabaseLayer(2)),
);

const owner = UserId.make("owner");
const due = new Date("2026-01-01T00:00:00.000Z");
const populated = new Date("2026-01-02T00:00:00.000Z");
const future = new Date("2999-01-01T00:00:00.000Z");

const installGraphPlugin = Effect.fn(function* () {
	const slug = `graph-${crypto.randomUUID().slice(0, 8)}`;
	const plugin = revisionPackage(slug);
	const endpoints = {
		propertiesSchema: { fields: {} },
		sourceEntitySchemaSlug: `${slug}-entity`,
		targetEntitySchemaSlug: `${slug}-entity`,
	};
	const { pluginId } = yield* installRevisionPackage({
		...plugin,
		manifest: {
			...plugin.manifest,
			relationshipSchemas: [
				{ ...endpoints, name: "Part", slug: "part", retention: "composition" },
				{ ...endpoints, name: "Trend", slug: "trend", retention: "root" },
				{ ...endpoints, name: "Credit", slug: "credit" },
			],
		},
	});
	const [provider] = yield* (yield* DatabaseSession).run((db) =>
		db
			.select({ id: tables.sandboxProvider.id })
			.from(tables.sandboxProvider)
			.where(eq(tables.sandboxProvider.pluginId, pluginId)),
	);
	assert(provider);
	const entity = Effect.fn(function* (checkAfter = due) {
		const id = crypto.randomUUID();
		yield* (yield* DatabaseSession).run((db) =>
			db
				.insert(tables.entity)
				.values({
					id,
					name: id,
					checkAfter,
					externalId: id,
					providerId: provider.id,
					relatedPopulatedAt: populated,
					entitySchemaPluginId: pluginId,
					entitySchemaSlug: `${slug}-entity`,
				}),
		);
		return id;
	});
	const link = Effect.fn(function* (
		relationshipSchemaSlug: "part" | "trend" | "credit",
		sourceEntityId: string,
		targetEntityId: string,
		userId: null | UserId = null,
	) {
		yield* (yield* DatabaseSession).run((db) =>
			db
				.insert(tables.relationship)
				.values({
					userId,
					sourceEntityId,
					targetEntityId,
					relationshipSchemaSlug,
					relationshipSchemaPluginId: pluginId,
				}),
		);
	});
	return { link, entity };
});

const stored = Effect.fn(function* (ids: ReadonlyArray<string>) {
	const rows = yield* (yield* DatabaseSession).run((db) =>
		db
			.select({
				id: tables.entity.id,
				checkAfter: tables.entity.checkAfter,
				relatedPopulatedAt: tables.entity.relatedPopulatedAt,
			})
			.from(tables.entity)
			.where(inArray(tables.entity.id, [...ids])),
	);
	return new Map(rows.map((row) => [row.id, row]));
});

const collect = Effect.flatMap(EntityGraphCollector, (collector) => collector.runBatch(500));

layer(testLayer)((test) => {
	test.effect("collects due unreferenced entities with their dependent rows", () =>
		Effect.gen(function* () {
			const graph = yield* installGraphPlugin();
			const orphan = yield* graph.entity();
			const recent = yield* graph.entity(future);
			yield* (yield* DatabaseSession).run((db) =>
				db
					.insert(tables.entityTranslation)
					.values({ language: "es", entityId: orphan, sourceContentGeneration: 1 }),
			);

			yield* collect;

			const rows = yield* stored([orphan, recent]);
			expect([...rows.keys()]).toEqual([recent]);
			const translations = yield* (yield* DatabaseSession).run((db) =>
				db
					.select()
					.from(tables.entityTranslation)
					.where(eq(tables.entityTranslation.entityId, orphan)),
			);
			expect(translations).toEqual([]);
		}),
	);

	test.effect("defers entities kept by user relationships, events and root relationships", () =>
		Effect.gen(function* () {
			const graph = yield* installGraphPlugin();
			const library = yield* graph.entity();
			const watched = yield* graph.entity();
			const trending = yield* graph.entity();
			const other = yield* graph.entity(future);
			yield* graph.link("credit", library, other, owner);
			yield* graph.link("trend", trending, trending);
			yield* (yield* DatabaseSession).run((db) =>
				db
					.insert(tables.event)
					.values({ userId: owner, occurredAt: due, entityId: watched, eventSchemaSlug: "seen" }),
			);

			yield* collect;

			const rows = yield* stored([library, watched, trending]);
			expect(rows.size).toBe(3);
			for (const row of rows.values()) {
				expect(row.checkAfter.getTime()).toBeGreaterThan(populated.getTime());
			}
		}),
	);

	test.effect("keeps or collects a composition unit as a whole", () =>
		Effect.gen(function* () {
			const graph = yield* installGraphPlugin();
			const keptShow = yield* graph.entity();
			const keptSeason = yield* graph.entity();
			const keptEpisode = yield* graph.entity();
			const lostShow = yield* graph.entity();
			const lostSeason = yield* graph.entity();
			yield* graph.link("part", keptShow, keptSeason);
			yield* graph.link("part", keptSeason, keptEpisode);
			yield* graph.link("part", lostShow, lostSeason);
			yield* (yield* DatabaseSession).run((db) =>
				db
					.insert(tables.event)
					.values({
						userId: owner,
						occurredAt: due,
						entityId: keptEpisode,
						eventSchemaSlug: "seen",
					}),
			);

			yield* collect;

			const rows = yield* stored([keptShow, keptSeason, keptEpisode, lostShow, lostSeason]);
			expect(new Set(rows.keys())).toEqual(new Set([keptShow, keptSeason, keptEpisode]));
		}),
	);

	test.effect("retains one reference hop from a live entity and refreshes trimmed neighbors", () =>
		Effect.gen(function* () {
			const graph = yield* installGraphPlugin();
			const show = yield* graph.entity();
			const person = yield* graph.entity();
			const otherShow = yield* graph.entity();
			const otherSeason = yield* graph.entity();
			yield* graph.link("credit", show, show, owner);
			yield* graph.link("credit", person, show);
			yield* graph.link("credit", person, otherShow);
			yield* graph.link("part", otherShow, otherSeason);

			yield* collect;

			const rows = yield* stored([show, person, otherShow, otherSeason]);
			expect(new Set(rows.keys())).toEqual(new Set([show, person]));
			expect(rows.get(show)?.relatedPopulatedAt).toEqual(populated);
			expect(rows.get(person)?.relatedPopulatedAt).toBeNull();
		}),
	);

	test.effect("typed entity references in user-owned data keep entities", () =>
		Effect.gen(function* () {
			const graph = yield* installGraphPlugin();
			const referenced = yield* graph.entity();
			const slug = `reference-schema-${crypto.randomUUID()}`;
			const session = yield* DatabaseSession;
			yield* session.run((db) =>
				db
					.insert(tables.definitionEntitySchema)
					.values({
						slug,
						icon: "box",
						position: 0,
						name: "Reference",
						pluginRevisionId: null,
						mergeIdentityProperties: [],
						propertiesSchema: {
							fields: {
								subjects: {
									type: "array",
									label: "Subjects",
									description: "Subjects",
									items: {
										type: "string",
										label: "Subject",
										description: "Subject",
										reference: { kind: "entity-id" },
									},
								},
							},
						},
					}),
			);
			yield* session.run((db) =>
				db
					.insert(tables.entity)
					.values({
						name: "Note",
						userId: owner,
						entitySchemaSlug: slug,
						properties: { subjects: [referenced] },
					}),
			);

			yield* collect;

			expect((yield* stored([referenced])).has(referenced)).toBe(true);
		}),
	);

	test.effect("waits while a backup is running", () =>
		Effect.gen(function* () {
			const graph = yield* installGraphPlugin();
			const orphan = yield* graph.entity();
			const session = yield* DatabaseSession;
			const [backup] = yield* session.run((db) =>
				db
					.insert(tables.backupRun)
					.values({ userId: owner, kind: "export", status: "running" })
					.returning({ id: tables.backupRun.id }),
			);
			assert(backup);

			yield* collect;
			expect((yield* stored([orphan])).has(orphan)).toBe(true);

			yield* session.run((db) =>
				db
					.update(tables.backupRun)
					.set({ status: "completed" })
					.where(eq(tables.backupRun.id, backup.id)),
			);
			yield* collect;
			expect((yield* stored([orphan])).has(orphan)).toBe(false);
		}),
	);

	test.effect("skips an entity a writer holds, then collects it later", () =>
		Effect.gen(function* () {
			const graph = yield* installGraphPlugin();
			const orphan = yield* graph.entity();
			const session = yield* DatabaseSession;
			const locked = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			const writer = yield* Effect.forkScoped(
				session.transaction(
					Effect.gen(function* () {
						yield* session.run((db) =>
							db.execute(sql`select id from ${tables.entity} where id = ${orphan} for key share`),
						);
						yield* Deferred.succeed(locked, undefined);
						yield* Deferred.await(release);
					}),
				),
			);
			yield* Deferred.await(locked);

			yield* collect;
			expect((yield* stored([orphan])).has(orphan)).toBe(true);

			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(writer);
			yield* collect;
			expect((yield* stored([orphan])).has(orphan)).toBe(false);
		}),
	);
});
