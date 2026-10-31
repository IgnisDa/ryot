import { expect, layer } from "@effect/vitest";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { asc, eq } from "drizzle-orm";
import { Effect, Ref } from "effect";

import { LifecyclePlanner } from "#modules/automations/lifecycle/planning";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

import {
	baseInput,
	command,
	relationshipDatabaseLayer,
	relationshipsServiceWith,
	sourceEntityId,
} from "./lifecycle.test-support";
import { RelationshipsRepository } from "./repository";

const t1 = EntityId.make("generation-t1");
const t2 = EntityId.make("generation-t2");
const t3 = EntityId.make("generation-t3");
const t4 = EntityId.make("generation-t4");
const targetIds = [t1, t2, t3, t4];

const group = (
	relationships: ReadonlyArray<{ rank: number; target: EntityId | undefined }>,
	generation: { value: string; kind: "page" | "sweep"; preserveExisting?: boolean },
) => ({
	relationshipSchema: baseInput.relationshipSchema,
	generation: { preserveExisting: false, ...generation },
	selector: {
		type: "anchored" as const,
		direction: "outgoing" as const,
		anchorEntityId: sourceEntityId,
	},
	relationships: relationships.map(({ rank, target }) => ({
		sourceEntityId,
		properties: { rank },
		targetEntityId: target ?? sourceEntityId,
	})),
});

const setup = (scope: string) =>
	Effect.gen(function* () {
		const session = yield* DatabaseSession;
		const planned = yield* Ref.make<ReadonlyArray<string>>([]);
		const planner = yield* LifecyclePlanner;
		const service = yield* relationshipsServiceWith({
			planner: {
				...planner,
				plan: (input) =>
					planner.plan(input).pipe(
						Effect.tap(() => {
							const payload = input.trigger.payload;
							return payload?.resource === "relationship"
								? Ref.update(planned, (all) => [
										...all,
										`${payload.category}:${"operation" in payload ? payload.operation : ""}`,
									])
								: Effect.void;
						}),
					),
			},
		});
		yield* session.run((db) =>
			db
				.insert(tables.entity)
				.values(
					targetIds.map((id) => ({
						id,
						properties: {},
						name: String(id),
						entitySchemaSlug: "fixture",
					})),
				)
				.onConflictDoNothing(),
		);
		yield* session.run((db) => db.delete(tables.relationship));
		const persist = (
			identity: string,
			relationships: Parameters<typeof group>[0],
			generation: Parameters<typeof group>[1],
		) =>
			session.transaction(
				service.persistPlannedReconciliation(
					[group(relationships, generation)],
					command(`${scope}:${identity}`),
					{ scope: "global" },
				),
			);
		const rows = session
			.run((db) =>
				db
					.select()
					.from(tables.relationship)
					.where(eq(tables.relationship.sourceEntityId, sourceEntityId))
					.orderBy(asc(tables.relationship.targetEntityId)),
			)
			.pipe(
				Effect.map((all) =>
					all.map(({ properties, targetEntityId, syncGeneration }) => ({
						properties,
						syncGeneration,
						target: targetEntityId,
					})),
				),
			);
		return { rows, planned, persist, session };
	});

layer(relationshipDatabaseLayer())((test) => {
	test.effect("pages upsert and stamp only their entries and the sweep removes the rest", () =>
		Effect.gen(function* () {
			const { rows, persist } = yield* setup("pages");
			yield* persist(
				"seed",
				[
					{ rank: 1, target: t1 },
					{ rank: 9, target: t4 },
				],
				{ kind: "page", value: "old-generation" },
			);

			yield* persist(
				"page-0",
				[
					{ rank: 5, target: t1 },
					{ rank: 2, target: t2 },
				],
				{ value: "g1", kind: "page" },
			);
			expect(yield* rows).toEqual([
				{ target: t1, syncGeneration: "g1", properties: { rank: 5 } },
				{ target: t2, syncGeneration: "g1", properties: { rank: 2 } },
				{ target: t4, properties: { rank: 9 }, syncGeneration: "old-generation" },
			]);

			yield* persist("page-1", [{ rank: 3, target: t3 }], { value: "g1", kind: "page" });
			expect((yield* rows).map(({ target }) => target)).toEqual([t1, t2, t3, t4]);

			const swept = yield* persist("sweep", [], { value: "g1", kind: "sweep" });
			expect(swept.result).toEqual([{ created: 0, updated: 0, deleted: 1, upserted: 0 }]);
			expect(yield* rows).toEqual([
				{ target: t1, syncGeneration: "g1", properties: { rank: 5 } },
				{ target: t2, syncGeneration: "g1", properties: { rank: 2 } },
				{ target: t3, syncGeneration: "g1", properties: { rank: 3 } },
			]);
		}),
	);

	test.effect("additive pages keep existing properties while stamping the generation", () =>
		Effect.gen(function* () {
			const { rows, persist } = yield* setup("additive");
			yield* persist("seed", [{ rank: 1, target: t1 }], { kind: "page", value: "old" });
			yield* persist(
				"page",
				[
					{ rank: 7, target: t1 },
					{ rank: 2, target: t2 },
				],
				{ value: "g1", kind: "page", preserveExisting: true },
			);
			expect(yield* rows).toEqual([
				{ target: t1, syncGeneration: "g1", properties: { rank: 1 } },
				{ target: t2, syncGeneration: "g1", properties: { rank: 2 } },
			]);
		}),
	);

	test.effect("stamps unchanged rows without hooks, triggers or an updated_at bump", () =>
		Effect.gen(function* () {
			const { rows, persist, planned, session } = yield* setup("stamp");
			yield* persist("seed", [{ rank: 1, target: t1 }], { value: "g1", kind: "page" });
			const before = yield* session.run((db) =>
				db.select().from(tables.relationship).where(eq(tables.relationship.targetEntityId, t1)),
			);
			const triggersBefore = yield* session.run((db) => db.select().from(tables.automationTrigger));
			yield* Ref.set(planned, []);

			const repeated = yield* persist("repopulate", [{ rank: 1, target: t1 }], {
				value: "g2",
				kind: "page",
			});

			expect(repeated.result).toEqual([{ created: 0, updated: 0, deleted: 0, upserted: 1 }]);
			expect(yield* Ref.get(planned)).toEqual([]);
			expect(yield* rows).toEqual([{ target: t1, syncGeneration: "g2", properties: { rank: 1 } }]);
			const after = yield* session.run((db) =>
				db.select().from(tables.relationship).where(eq(tables.relationship.targetEntityId, t1)),
			);
			expect(after[0]?.updatedAt).toEqual(before[0]?.updatedAt);
			expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
				triggersBefore,
			);
		}),
	);

	test.effect("a sweep deletion fires the delete hook once and replays without conflicts", () =>
		Effect.gen(function* () {
			const { rows, persist, planned } = yield* setup("sweep");
			yield* persist(
				"seed",
				[
					{ rank: 1, target: t1 },
					{ rank: 2, target: t2 },
				],
				{ kind: "page", value: "old" },
			);
			yield* persist("page", [{ rank: 1, target: t1 }], { value: "g1", kind: "page" });
			yield* Ref.set(planned, []);

			const first = yield* persist("sweep", [], { value: "g1", kind: "sweep" });
			const deletePlans = (yield* Ref.get(planned)).filter((entry) => entry.endsWith("delete"));
			expect(deletePlans).toEqual(["change:delete"]);

			yield* Ref.set(planned, []);
			const replayed = yield* persist("sweep", [], { value: "g1", kind: "sweep" });
			expect(replayed).toEqual(first);
			expect(yield* Ref.get(planned)).toEqual([]);
			expect((yield* rows).map(({ target }) => target)).toEqual([t1]);

			const replayedPage = yield* persist("page", [{ rank: 1, target: t1 }], {
				value: "g1",
				kind: "page",
			});
			expect(replayedPage.result).toEqual([{ created: 0, updated: 0, deleted: 0, upserted: 1 }]);
		}),
	);

	test.effect("holds a group generation only for its latest claimant", () =>
		Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* RelationshipsRepository;
			const key = {
				anchorEntityId: sourceEntityId,
				direction: "outgoing" as const,
				relationshipSchemaPluginId: null,
				relationshipSchemaSlug: baseInput.relationshipSchemaSlug,
			};
			const holds = (generation: string) =>
				session.transaction(repository.holdsRelationshipSyncGeneration(key, generation));
			const claim = (generation: string) =>
				session.transaction(
					repository.claimRelationshipSyncGeneration(key, generation, new Date()),
				);

			expect(yield* holds("g1")).toBe(false);
			yield* claim("g1");
			expect(yield* holds("g1")).toBe(true);
			yield* claim("g2");
			expect(yield* holds("g1")).toBe(false);
			expect(yield* holds("g2")).toBe(true);
			expect(
				yield* session.run((db) => db.select().from(tables.relationshipSyncGeneration)),
			).toHaveLength(1);
		}),
	);
});
