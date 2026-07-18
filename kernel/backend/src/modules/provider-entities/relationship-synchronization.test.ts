import { expect, it } from "@effect/vitest";
import {
	AutomationExecutionId,
	EntityId,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { Effect, Layer } from "effect";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { databaseLayer } from "#lib/test-utils/effect";
import {
	DefinitionRegistry,
	definitionSourceFromSnapshot,
	makeDefinitionRegistry,
} from "#modules/definition-registry/service";
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
const registry = makeDefinitionRegistry(
	definitionSourceFromSnapshot({
		savedViews: {},
		entitySchemas: {},
		signalSchemas: {},
		relationshipSchemas: {},
	}),
);
const support = Layer.mergeAll(
	databaseLayer,
	Layer.succeed(DefinitionRegistry, registry),
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

it.effect("passes authoritative global synchronization to planned reconciliation", () => {
	const calls: unknown[] = [];
	const layer = Layer.mergeAll(
		support,
		Layer.mock(RelationshipsRepository)({}),
		Layer.mock(RelationshipsService)({
			persistPlannedReconciliation: (groups, receivedCommand, scope) =>
				Effect.sync(() => {
					calls.push({ scope, groups, command: receivedCommand });
					return { plans: [], result: [{ created: 1, updated: 0, deleted: 0, upserted: 1 }] };
				}),
		}),
	);

	return Effect.gen(function* () {
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
		expect(calls).toEqual([
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
	}).pipe(Effect.provide(layer));
});

it.effect("preserves private additive relationships and their stored properties", () => {
	let received: unknown;
	const layer = Layer.mergeAll(
		support,
		Layer.mock(RelationshipsRepository)({
			listRelationshipsForReconciliation: (input) =>
				Effect.sync(() => {
					expect(input).toMatchObject({ userId, scope: "user", relationshipSchemaPluginId: "p1" });
					return [
						row(relatedEntityId, { role: "actor" }),
						row(staleEntityId, { role: "producer" }),
					];
				}),
		}),
		Layer.mock(RelationshipsService)({
			persistPlannedReconciliation: (groups, _command, scope) =>
				Effect.sync(() => {
					received = { scope, groups };
					return { plans: [], result: [{ created: 0, updated: 0, deleted: 0, upserted: 2 }] };
				}),
		}),
	);

	return Effect.gen(function* () {
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
	}).pipe(Effect.provide(layer));
});

it.effect("preserves matching properties but omits stale authoritative relationships", () => {
	let relationships: ReadonlyArray<unknown> = [];
	const layer = Layer.mergeAll(
		support,
		Layer.mock(RelationshipsRepository)({
			listRelationshipsForReconciliation: () =>
				Effect.succeed([
					row(relatedEntityId, { role: "actor" }),
					row(staleEntityId, { role: "producer" }),
				]),
		}),
		Layer.mock(RelationshipsService)({
			persistPlannedReconciliation: (groups) =>
				Effect.sync(() => {
					relationships = groups[0]?.relationships ?? [];
					return { plans: [], result: [{ created: 0, updated: 0, deleted: 1, upserted: 1 }] };
				}),
		}),
	);

	return Effect.gen(function* () {
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
		expect(relationships).toMatchObject([
			{ properties: { role: "actor" }, targetEntityId: relatedEntityId },
		]);
	}).pipe(Effect.provide(layer));
});
