import { expect, layer } from "@effect/vitest";
import {
	AutomationExecutionId,
	EntityId,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Context, Effect, Layer, Ref } from "effect";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { databaseLayer } from "#lib/test-utils/effect";
import { DefinitionRepository } from "#modules/definition-registry/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { RelationshipsRepository } from "#modules/relationships/repository";
import { RelationshipsService } from "#modules/relationships/service";

import { persistPlannedRelationshipSynchronization } from "./relationship-synchronization";

const userId = UserId.make("user-1");
const anchorEntityId = EntityId.make("anchor");
const relatedEntityId = EntityId.make("related");
const staleEntityId = EntityId.make("stale");
const relationshipSchemaSlug = RelationshipSchemaSlug.make("credits");
const command = rootLifecycleCommand({
	source: "api",
	itemIdentity: "relationship-sync",
	initiator: { id: userId, kind: "user" },
	occurredAt: IsoUtcString.make("2026-09-16T00:00:00.000Z"),
	executionId: AutomationExecutionId.make("relationship-sync"),
});
const support = Layer.mergeAll(
	databaseLayer,
	Layer.mock(DefinitionRepository)({}),
	Layer.mock(EntitiesRepository)({}),
);

const row = (targetEntityId: typeof relatedEntityId, properties: Record<string, unknown>) => ({
	properties,
	targetEntityId,
	relationshipSchemaSlug,
	sourceEntityId: anchorEntityId,
	createdAt: "2026-09-16T00:00:00.000Z",
	updatedAt: "2026-09-16T00:00:00.000Z",
	id: RelationshipId.make(`relationship-${targetEntityId}`),
});

type Reconcile = RelationshipsService["Service"]["persistPlannedReconciliation"];
type Reconciliation = {
	readonly groups: Parameters<Reconcile>[0];
	readonly command: Parameters<Reconcile>[1];
	readonly scope: Parameters<Reconcile>[2];
};
type ListInput = Parameters<
	RelationshipsRepository["Service"]["listRelationshipsForReconciliation"]
>[0];

class FakeRelationshipSynchronization extends Context.Service<
	FakeRelationshipSynchronization,
	{
		readonly listings: Effect.Effect<ReadonlyArray<ListInput>>;
		readonly reconciliations: Effect.Effect<ReadonlyArray<Reconciliation>>;
	}
>()("test/FakeRelationshipSynchronization") {}

const synchronizationLayer = (options: {
	readonly stored?: ReadonlyArray<ReturnType<typeof row>>;
	readonly result: Effect.Success<ReturnType<Reconcile>>["result"];
}) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const listings = yield* Ref.make<ReadonlyArray<ListInput>>([]);
			const reconciliations = yield* Ref.make<ReadonlyArray<Reconciliation>>([]);
			return Layer.mergeAll(
				support,
				Layer.mock(RelationshipsRepository)({
					listRelationshipsForReconciliation: (input) =>
						Ref.update(listings, (all) => [...all, input]).pipe(
							Effect.as([...(options.stored ?? [])]),
						),
				}),
				Layer.mock(RelationshipsService)({
					persistPlannedReconciliation: (groups, receivedCommand, scope) =>
						Ref.update(reconciliations, (all) => [
							...all,
							{ scope, groups, command: receivedCommand },
						]).pipe(Effect.as({ plans: [], result: options.result })),
				}),
				Layer.succeed(FakeRelationshipSynchronization, {
					listings: Ref.get(listings),
					reconciliations: Ref.get(reconciliations),
				}),
			);
		}),
	);

layer(synchronizationLayer({ result: [{ created: 1, updated: 0, deleted: 0, upserted: 1 }] }))(
	(test) => {
		test.effect("passes authoritative global synchronization to planned reconciliation", () =>
			Effect.gen(function* () {
				const result = yield* persistPlannedRelationshipSynchronization({
					command,
					anchorEntityId,
					scope: "global",
					direction: "outgoing",
					relationshipSchemaSlug,
					onConflict: "replaceProperties",
					synchronization: "authoritative",
					entries: [{ entityId: relatedEntityId, properties: { role: "director" } }],
				});
				expect(result.result).toEqual([{ created: 1, updated: 0, deleted: 0, upserted: 1 }]);
				expect(yield* (yield* FakeRelationshipSynchronization).reconciliations).toEqual([
					{
						command,
						scope: { scope: "global" },
						groups: [
							{
								relationshipSchemaSlug,
								selector: { anchorEntityId, type: "anchored", direction: "outgoing" },
								relationships: [
									{
										sourceEntityId: anchorEntityId,
										targetEntityId: relatedEntityId,
										properties: { role: "director" },
									},
								],
							},
						],
					},
				]);
			}),
		);
	},
);

layer(
	synchronizationLayer({
		result: [{ created: 0, updated: 0, deleted: 0, upserted: 2 }],
		stored: [row(relatedEntityId, { role: "actor" }), row(staleEntityId, { role: "producer" })],
	}),
)((test) => {
	test.effect("preserves private additive relationships and their stored properties", () =>
		Effect.gen(function* () {
			yield* persistPlannedRelationshipSynchronization({
				userId,
				command,
				scope: "user",
				anchorEntityId,
				direction: "outgoing",
				relationshipSchemaSlug,
				synchronization: "additive",
				onConflict: "preserveExisting",
				relationshipSchemaPluginId: "p1",
				entries: [{ entityId: relatedEntityId, properties: { role: "director" } }],
			});
			const fake = yield* FakeRelationshipSynchronization;
			for (const input of yield* fake.listings) {
				expect(input).toMatchObject({ userId, scope: "user", relationshipSchemaPluginId: "p1" });
			}
			const [received] = yield* fake.reconciliations;
			expect(received).toMatchObject({
				scope: { userId, scope: "user" },
				groups: [
					{
						relationships: [
							{ properties: { role: "actor" }, targetEntityId: relatedEntityId },
							{ targetEntityId: staleEntityId, properties: { role: "producer" } },
						],
					},
				],
			});
		}),
	);
});

layer(
	synchronizationLayer({
		result: [{ created: 0, updated: 0, deleted: 1, upserted: 1 }],
		stored: [row(relatedEntityId, { role: "actor" }), row(staleEntityId, { role: "producer" })],
	}),
)((test) => {
	test.effect("preserves matching properties but omits stale authoritative relationships", () =>
		Effect.gen(function* () {
			yield* persistPlannedRelationshipSynchronization({
				command,
				anchorEntityId,
				scope: "global",
				direction: "outgoing",
				relationshipSchemaSlug,
				onConflict: "preserveExisting",
				synchronization: "authoritative",
				entries: [{ entityId: relatedEntityId, properties: { role: "director" } }],
			});
			const [received] = yield* (yield* FakeRelationshipSynchronization).reconciliations;
			expect(received?.groups[0]?.relationships ?? []).toMatchObject([
				{ properties: { role: "actor" }, targetEntityId: relatedEntityId },
			]);
		}),
	);
});
