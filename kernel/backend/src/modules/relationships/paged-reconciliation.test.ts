import { expect } from "bun:test";

import type { AutomationTrigger } from "@ryot-app/contract/modules/automations/lifecycle";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { layer } from "@voila.dev/effect-bun-test";
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

const t1 = EntityId.make("paged-t1");
const t2 = EntityId.make("paged-t2");
const t3 = EntityId.make("paged-t3");
const t4 = EntityId.make("paged-t4");
const targetIds = [t1, t2, t3, t4];

type Paging =
	| { readonly kind: "page"; readonly preserveExisting: boolean }
	| { readonly kind: "sweep"; readonly kept: ReadonlySet<string> };

const page: Paging = { kind: "page", preserveExisting: false };

const group = (
	relationships: ReadonlyArray<{ rank: number; target: EntityId | undefined }>,
	paging: Paging,
) => ({
	paging,
	relationshipSchema: baseInput.relationshipSchema,
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
		const record = (input: { trigger: AutomationTrigger }) => {
			const payload = input.trigger.payload;
			return payload?.resource === "relationship"
				? Ref.update(planned, (all) => [
						...all,
						`${payload.category}:${"operation" in payload ? payload.operation : ""}`,
					])
				: Effect.void;
		};
		const service = yield* relationshipsServiceWith({
			planner: {
				...planner,
				plan: (input) => planner.plan(input).pipe(Effect.tap(() => record(input))),
				planChange: (input) => planner.planChange(input).pipe(Effect.tap(() => record(input))),
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
			paging: Paging,
		) =>
			session.transaction(
				service.persistPlannedReconciliation(
					[group(relationships, paging)],
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
					all.map(({ properties, targetEntityId }) => ({ properties, target: targetEntityId })),
				),
			);
		return { rows, planned, persist, session };
	});

layer(relationshipDatabaseLayer())((test) => {
	test.effect(
		"pages upsert only their entries and the sweep removes what was not kept",
		() =>
			Effect.gen(function* () {
				const { rows, persist } = yield* setup("pages");
				yield* persist(
					"seed",
					[
						{ rank: 1, target: t1 },
						{ rank: 9, target: t4 },
					],
					page,
				);

				yield* persist(
					"page-0",
					[
						{ rank: 5, target: t1 },
						{ rank: 2, target: t2 },
					],
					page,
				);
				expect(yield* rows).toEqual([
					{ target: t1, properties: { rank: 5 } },
					{ target: t2, properties: { rank: 2 } },
					{ target: t4, properties: { rank: 9 } },
				]);

				yield* persist("page-1", [{ rank: 3, target: t3 }], page);
				expect((yield* rows).map(({ target }) => target)).toEqual([t1, t2, t3, t4]);

				const swept = yield* persist("sweep", [], { kind: "sweep", kept: new Set([t1, t2, t3]) });
				expect(swept.result).toEqual([{ created: 0, updated: 0, deleted: 1, upserted: 0 }]);
				expect(yield* rows).toEqual([
					{ target: t1, properties: { rank: 5 } },
					{ target: t2, properties: { rank: 2 } },
					{ target: t3, properties: { rank: 3 } },
				]);
			}),
		testTimeout,
	);

	test.effect(
		"additive pages keep existing properties",
		() =>
			Effect.gen(function* () {
				const { rows, persist } = yield* setup("additive");
				yield* persist("seed", [{ rank: 1, target: t1 }], page);
				yield* persist(
					"page",
					[
						{ rank: 7, target: t1 },
						{ rank: 2, target: t2 },
					],
					{ kind: "page", preserveExisting: true },
				);
				expect(yield* rows).toEqual([
					{ target: t1, properties: { rank: 1 } },
					{ target: t2, properties: { rank: 2 } },
				]);
			}),
		testTimeout,
	);

	test.effect(
		"a repeated page leaves unchanged rows without hooks, triggers or an updated_at bump",
		() =>
			Effect.gen(function* () {
				const { rows, persist, planned, session } = yield* setup("repeat");
				yield* persist("seed", [{ rank: 1, target: t1 }], page);
				const before = yield* session.run((db) =>
					db.select().from(tables.relationship).where(eq(tables.relationship.targetEntityId, t1)),
				);
				const triggersBefore = yield* session.run((db) =>
					db.select().from(tables.automationTrigger),
				);
				yield* Ref.set(planned, []);

				yield* persist("repopulate", [{ rank: 1, target: t1 }], page);

				expect(yield* Ref.get(planned)).toEqual([]);
				expect(yield* rows).toEqual([{ target: t1, properties: { rank: 1 } }]);
				const after = yield* session.run((db) =>
					db.select().from(tables.relationship).where(eq(tables.relationship.targetEntityId, t1)),
				);
				expect(after[0]?.updatedAt).toEqual(before[0]?.updatedAt);
				expect(yield* session.run((db) => db.select().from(tables.automationTrigger))).toEqual(
					triggersBefore,
				);
			}),
		testTimeout,
	);

	test.effect(
		"a sweep deletion fires the delete hook once",
		() =>
			Effect.gen(function* () {
				const { rows, persist, planned } = yield* setup("sweep");
				yield* persist(
					"seed",
					[
						{ rank: 1, target: t1 },
						{ rank: 2, target: t2 },
					],
					page,
				);
				yield* Ref.set(planned, []);

				yield* persist("sweep", [], { kind: "sweep", kept: new Set([t1]) });
				const deletePlans = (yield* Ref.get(planned)).filter((entry) => entry.endsWith("delete"));
				expect(deletePlans).toEqual(["change:delete"]);
				expect((yield* rows).map(({ target }) => target)).toEqual([t1]);
			}),
		testTimeout,
	);
});
