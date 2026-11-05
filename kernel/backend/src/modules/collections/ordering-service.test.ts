import { expect } from "bun:test";

import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	CollectionConflict,
	CollectionNotFound,
	type ReorderMembershipBody,
} from "@ryot-app/contract/modules/collections/schemas";
import {
	EntityId,
	PluginId,
	RelationshipId,
	RelationshipSchemaSlug,
	UserId,
} from "@ryot-app/contract/schema/brands";
import { UTC } from "@ryot-app/contract/schema/time-zone";
import { assert } from "@ryot-app/testing/assert";
import { assertExitFails } from "@ryot-app/testing/effect-assertions";
import { randomUuid } from "@ryot-app/testing/random";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { sortBy } from "@ryot-app/ts-utils/lodash";
import { layer } from "@voila.dev/effect-bun-test";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Exit, Layer } from "effect";

import { CollectionOrderingService } from "#modules/collections/ordering-service";
import { CollectionsRepository } from "#modules/collections/repository";
import { EntitiesRepository } from "#modules/entities/repository";
import { revisionDatabaseLayer } from "#modules/plugins/packages/revision.test-support";
import { testPluginPackageId } from "#modules/plugins/test-support";
import {
	type CreateRelationshipInput,
	RelationshipsRepository,
} from "#modules/relationships/repository";
import { DatabaseSession } from "#platform/db/session";
import * as tables from "#schema/tables/combined";

const ownerId = UserId.make("owner");
const recipientId = UserId.make("recipient");
const collectionCreatedAt = new Date(Date.UTC(2020, 0, 1));
const membershipCreatedAt = Array.from(
	{ length: 1_000 },
	(_, index) => new Date(Date.UTC(2020, 0, index + 1)),
);

const currentUser = (id: UserId): CurrentUserValue => ({
	id,
	image: null,
	email: `${id}@example.test`,
	name: id === ownerId ? "Owner" : "Recipient",
	accountGeneration: { userId: id, token: "test-account-generation" },
	preferences: { language: null, reportingTimeZone: UTC, disableIntegrations: false },
});

type FixtureOptions = {
	readonly rankStep?: number;
	readonly memberCount?: number;
	readonly seededMemberCount?: number;
};

const makeFixture = Effect.fnUntraced(function* (options: FixtureOptions = {}) {
	const session = yield* DatabaseSession;
	const suffix = (yield* randomUuid).replaceAll("-", "");
	const memberCount = options.memberCount ?? 5;
	const seededMemberCount = options.seededMemberCount ?? memberCount;
	const rankStep = options.rankStep ?? 100;
	const collectionId = EntityId.make(`collection-${suffix}`);
	const memberIds = Array.from({ length: memberCount }, (_, index) =>
		EntityId.make(`member-${suffix}-${index}`),
	);
	yield* session.run((db) =>
		db
			.insert(tables.entity)
			.values([
				{
					properties: {},
					userId: ownerId,
					id: collectionId,
					entitySchemaPluginId: null,
					name: `Collection ${suffix}`,
					entitySchemaSlug: "collection",
					createdAt: collectionCreatedAt,
				},
				...memberIds.map((id, index) => ({
					id,
					properties: {},
					userId: ownerId,
					entitySchemaPluginId: null,
					name: `Member ${suffix} ${index}`,
					entitySchemaSlug: "fixture-record",
				})),
			]),
	);
	if (seededMemberCount > 0) {
		yield* session.run((db) =>
			db.insert(tables.relationship).values(
				memberIds.slice(0, seededMemberCount).map((sourceEntityId, index) => {
					const createdAt = membershipCreatedAt[index];
					assert(createdAt);
					return {
						createdAt,
						sourceEntityId,
						userId: ownerId,
						updatedAt: createdAt,
						targetEntityId: collectionId,
						relationshipSchemaPluginId: null,
						relationshipSchemaSlug: "member-of",
						id: RelationshipId.make(`membership-${suffix}-${index}`),
						properties: {
							note: `note-${index}`,
							rank: index * rankStep,
							metadata: { sourceIndex: index },
						},
					};
				}),
			),
		);
	}
	return { memberIds, collectionId };
});

const membershipRows = Effect.fnUntraced(function* (collectionId: EntityId) {
	const session = yield* DatabaseSession;
	return yield* session.run((db) =>
		db
			.select({
				id: tables.relationship.id,
				createdAt: tables.relationship.createdAt,
				properties: tables.relationship.properties,
				sourceEntityId: tables.relationship.sourceEntityId,
			})
			.from(tables.relationship)
			.where(
				and(
					eq(tables.relationship.userId, ownerId),
					eq(tables.relationship.targetEntityId, collectionId),
					eq(tables.relationship.relationshipSchemaSlug, "member-of"),
					isNull(tables.relationship.relationshipSchemaPluginId),
				),
			),
	);
});

const rankOf = (properties: Record<string, unknown>) => {
	const rank = properties["rank"];
	assert(typeof rank === "number" && Number.isSafeInteger(rank));
	return rank;
};

const orderedMemberIds = Effect.fnUntraced(function* (collectionId: EntityId) {
	const rows = yield* membershipRows(collectionId);
	return sortBy(rows, (row) => rankOf(row.properties)).map(({ sourceEntityId }) =>
		EntityId.make(sourceEntityId),
	);
});

const orderRevision = Effect.fnUntraced(function* (
	collectionId: EntityId,
	userId: UserId = ownerId,
) {
	const collections = yield* CollectionsRepository;
	const revision = yield* collections.getOrderRevision(collectionId, userId);
	assert(revision !== null);
	return revision;
});

const reorderInput = (
	collectionId: EntityId,
	entityId: EntityId,
	expectedRevision: number,
	destination: ReorderMembershipBody["destination"],
): ReorderMembershipBody => ({ entityId, destination, collectionId, expectedRevision });

const entitiesLayer = EntitiesRepository.layer.pipe(Layer.provideMerge(revisionDatabaseLayer));
const repositoriesLayer = Layer.mergeAll(
	CollectionsRepository.layer,
	RelationshipsRepository.layer,
).pipe(Layer.provideMerge(entitiesLayer));
const orderingLayer = CollectionOrderingService.layer.pipe(Layer.provideMerge(repositoriesLayer));

layer(orderingLayer)((test) => {
	test.effect(
		"moves members to every destination, preserves metadata and create times, and keeps no-op revisions",
		() =>
			Effect.gen(function* () {
				const ordering = yield* CollectionOrderingService;
				const fixture = yield* makeFixture({ memberCount: 4 });
				const [a, b, c, d] = fixture.memberIds;
				assert(a && b && c && d);
				const originalRows = yield* membershipRows(fixture.collectionId);
				let revision = yield* orderRevision(fixture.collectionId);
				const moves: ReadonlyArray<{
					readonly member: EntityId;
					readonly expected: ReadonlyArray<EntityId>;
					readonly destination: ReorderMembershipBody["destination"];
				}> = [
					{ member: d, expected: [a, d, b, c], destination: { entityId: b, kind: "before" } },
					{ member: a, expected: [d, b, c, a], destination: { entityId: c, kind: "after" } },
					{ member: b, expected: [b, d, c, a], destination: { kind: "start" } },
					{ member: d, expected: [b, c, a, d], destination: { kind: "end" } },
				];
				for (const move of moves) {
					const result = yield* ordering.reorder(
						currentUser(ownerId),
						reorderInput(fixture.collectionId, move.member, revision, move.destination),
					);
					revision += 1;
					expect(result).toEqual({ orderRevision: revision, collectionId: fixture.collectionId });
					expect(yield* orderedMemberIds(fixture.collectionId)).toEqual<unknown>(move.expected);
				}
				const noOp = yield* ordering.reorder(
					currentUser(ownerId),
					reorderInput(fixture.collectionId, d, revision, { kind: "end" }),
				);
				expect(noOp.orderRevision).toBe(revision);
				expect(yield* orderRevision(fixture.collectionId)).toBe(revision);
				const finalRows = yield* membershipRows(fixture.collectionId);
				for (const original of originalRows) {
					const final = finalRows.find((row) => row.sourceEntityId === original.sourceEntityId);
					assert(final);
					expect(final.createdAt).toEqual(original.createdAt);
					expect(final.properties).toMatchObject({
						note: original.properties["note"],
						metadata: original.properties["metadata"],
					});
				}
			}),
		testTimeout,
	);

	test.effect(
		"accepts a resend while the member stays at its destination and rejects it after a later move",
		() =>
			Effect.gen(function* () {
				const ordering = yield* CollectionOrderingService;
				const fixture = yield* makeFixture({ memberCount: 4 });
				const [a, b] = fixture.memberIds;
				assert(a && b);
				const revision = yield* orderRevision(fixture.collectionId);
				const input = reorderInput(fixture.collectionId, a, revision, { kind: "end" });
				const firstResult = yield* ordering.reorder(currentUser(ownerId), input);
				expect(yield* ordering.reorder(currentUser(ownerId), input)).toEqual(firstResult);
				yield* ordering.reorder(
					currentUser(ownerId),
					reorderInput(fixture.collectionId, b, firstResult.orderRevision, { kind: "end" }),
				);
				const laterOrder = yield* orderedMemberIds(fixture.collectionId);
				assertExitFails(
					yield* Effect.exit(ordering.reorder(currentUser(ownerId), input)),
					new CollectionConflict({ reason: { code: "order-stale" } }),
				);
				expect(yield* orderedMemberIds(fixture.collectionId)).toEqual(laterOrder);
			}),
		testTimeout,
	);

	test.effect(
		"allows only one concurrent reorder at a shared expected revision",
		() =>
			Effect.gen(function* () {
				const ordering = yield* CollectionOrderingService;
				const fixture = yield* makeFixture({ memberCount: 4 });
				const [a, , c] = fixture.memberIds;
				assert(a && c);
				const revision = yield* orderRevision(fixture.collectionId);
				const moves: ReadonlyArray<{
					readonly member: EntityId;
					readonly destination: ReorderMembershipBody["destination"];
				}> = [
					{ member: a, destination: { kind: "end" } },
					{ member: c, destination: { kind: "start" } },
				];
				const exits = yield* Effect.forEach(
					moves,
					({ member, destination }) =>
						Effect.exit(
							ordering.reorder(
								currentUser(ownerId),
								reorderInput(fixture.collectionId, member, revision, destination),
							),
						),
					{ concurrency: 2 },
				);
				expect(exits.filter(Exit.isSuccess)).toHaveLength(1);
				const failure = exits.find(Exit.isFailure);
				assert(failure);
				assertExitFails(failure, new CollectionConflict({ reason: { code: "order-stale" } }));
			}),
		testTimeout,
	);

	test.effect(
		"does not stale a collection after a different collection changes",
		() =>
			Effect.gen(function* () {
				const ordering = yield* CollectionOrderingService;
				const left = yield* makeFixture({ memberCount: 3 });
				const right = yield* makeFixture({ memberCount: 3 });
				const leftRevision = yield* orderRevision(left.collectionId);
				const rightRevision = yield* orderRevision(right.collectionId);
				const rightMember = right.memberIds[0];
				const leftMember = left.memberIds[0];
				assert(rightMember && leftMember);
				const changedRight = yield* ordering.reorder(
					currentUser(ownerId),
					reorderInput(right.collectionId, rightMember, rightRevision, { kind: "end" }),
				);
				expect(changedRight.orderRevision).toBeGreaterThan(rightRevision);
				const changedLeft = yield* ordering.reorder(
					currentUser(ownerId),
					reorderInput(left.collectionId, leftMember, leftRevision, { kind: "end" }),
				);
				expect(changedLeft.orderRevision).toBeGreaterThan(leftRevision);
			}),
		testTimeout,
	);

	test.effect(
		"rejects missing members, missing anchors, and foreign owners without changing order",
		() =>
			Effect.gen(function* () {
				const ordering = yield* CollectionOrderingService;
				const fixture = yield* makeFixture({ memberCount: 3 });
				const member = fixture.memberIds[0];
				assert(member);
				const revision = yield* orderRevision(fixture.collectionId);
				const initialOrder = yield* orderedMemberIds(fixture.collectionId);
				const missingMember = EntityId.make(`missing-member-${yield* randomUuid}`);
				const missingAnchor = EntityId.make(`missing-anchor-${yield* randomUuid}`);
				assertExitFails(
					yield* Effect.exit(
						ordering.reorder(
							currentUser(ownerId),
							reorderInput(fixture.collectionId, missingMember, revision, { kind: "end" }),
						),
					),
					new CollectionNotFound({
						reason: {
							entityId: missingMember,
							code: "membership-not-found",
							collectionId: fixture.collectionId,
						},
					}),
				);
				assertExitFails(
					yield* Effect.exit(
						ordering.reorder(
							currentUser(ownerId),
							reorderInput(fixture.collectionId, member, revision, {
								kind: "before",
								entityId: missingAnchor,
							}),
						),
					),
					new CollectionNotFound({
						reason: {
							entityId: missingAnchor,
							code: "membership-not-found",
							collectionId: fixture.collectionId,
						},
					}),
				);
				assertExitFails(
					yield* Effect.exit(
						ordering.reorder(
							currentUser(recipientId),
							reorderInput(fixture.collectionId, member, revision, { kind: "end" }),
						),
					),
					new CollectionNotFound({
						reason: { code: "collection-not-found", collectionId: fixture.collectionId },
					}),
				);
				expect(yield* orderedMemberIds(fixture.collectionId)).toEqual(initialOrder);
				expect(yield* orderRevision(fixture.collectionId)).toBe(revision);
			}),
		testTimeout,
	);

	test.effect(
		"serializes new memberships, ignores incoming ranks, and preserves ranks on metadata updates",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const relationships = yield* RelationshipsRepository;
				const fixture = yield* makeFixture({ memberCount: 6, seededMemberCount: 4 });
				const unseededMembers = fixture.memberIds.slice(4);
				const inputs: ReadonlyArray<CreateRelationshipInput> = unseededMembers.map(
					(sourceEntityId, index) => ({
						scope: "user",
						sourceEntityId,
						userId: ownerId,
						relationshipSchemaPluginId: null,
						targetEntityId: fixture.collectionId,
						relationshipSchemaSlug: RelationshipSchemaSlug.make("member-of"),
						properties: { note: `created-${index}`, rank: -99_999_999 - index },
					}),
				);
				const created = yield* Effect.forEach(
					inputs,
					(input) =>
						session.transaction(
							Effect.gen(function* () {
								yield* relationships.lockRelationshipMutations([input]);
								return yield* relationships.createRelationship(input);
							}),
						),
					{ concurrency: 2 },
				);
				expect(created).toHaveLength(2);
				const createdRanks = created.map(({ properties }) => rankOf(properties));
				expect(createdRanks.every(Number.isSafeInteger)).toBe(true);
				expect(new Set(createdRanks).size).toBe(2);
				for (const [index, row] of created.entries()) {
					expect(row.properties["rank"]).not.toBe(inputs[index]?.properties["rank"]);
					expect(row.properties["note"]).toBe(`created-${index}`);
				}
				const firstCreated = created[0];
				assert(firstCreated);
				const initialRank = rankOf(firstCreated.properties);
				const updatedRevision = yield* orderRevision(fixture.collectionId);
				const updatedRows = yield* relationships.updateRelationshipsById([
					{ id: firstCreated.id, properties: { rank: 9_999_999, note: "metadata-updated" } },
				]);
				const updated = updatedRows.get(firstCreated.id);
				assert(updated);
				expect(updated.properties).toEqual({ rank: initialRank, note: "metadata-updated" });
				expect(yield* orderRevision(fixture.collectionId)).toBe(updatedRevision);
				const allRanks = (yield* membershipRows(fixture.collectionId)).map(({ properties }) =>
					rankOf(properties),
				);
				expect(new Set(allRanks).size).toBe(allRanks.length);
				const ordered = yield* orderedMemberIds(fixture.collectionId);
				expect(new Set(ordered.slice(0, 2))).toEqual(new Set(unseededMembers));
			}),
		testTimeout,
	);

	test.effect(
		"rebalances a bounded window during repeated adjacent moves without changing far ranks or metadata",
		() =>
			Effect.gen(function* () {
				const ordering = yield* CollectionOrderingService;
				const fixture = yield* makeFixture({ memberCount: 340, rankStep: 2 ** 32 });
				const anchor = fixture.memberIds[150];
				const second = fixture.memberIds[151];
				const first = fixture.memberIds[152];
				const farLeft = fixture.memberIds[0];
				const farRight = fixture.memberIds[339];
				assert(anchor && second && first && farLeft && farRight);
				const originalRows = yield* membershipRows(fixture.collectionId);
				const originalFarLeft = originalRows.find((row) => row.sourceEntityId === farLeft);
				const originalFarRight = originalRows.find((row) => row.sourceEntityId === farRight);
				assert(originalFarLeft && originalFarRight);
				const originalRevision = yield* orderRevision(fixture.collectionId);
				let revision = originalRevision;
				for (let index = 0; index < 160; index += 1) {
					const member = index % 2 === 0 ? first : second;
					const result = yield* ordering.reorder(
						currentUser(ownerId),
						reorderInput(fixture.collectionId, member, revision, {
							kind: "after",
							entityId: anchor,
						}),
					);
					revision = result.orderRevision;
				}
				expect(revision).toBeGreaterThan(originalRevision + 160);
				const rows = yield* membershipRows(fixture.collectionId);
				const ranks = rows.map(({ properties }) => rankOf(properties));
				expect(new Set(ranks).size).toBe(rows.length);
				expect(ranks.every(Number.isSafeInteger)).toBe(true);
				const finalFarLeft = rows.find((row) => row.sourceEntityId === farLeft);
				const finalFarRight = rows.find((row) => row.sourceEntityId === farRight);
				assert(finalFarLeft && finalFarRight);
				expect(rankOf(finalFarLeft.properties)).toBe(rankOf(originalFarLeft.properties));
				expect(rankOf(finalFarRight.properties)).toBe(rankOf(originalFarRight.properties));
				for (const row of rows) {
					const originalIndex = fixture.memberIds.indexOf(EntityId.make(row.sourceEntityId));
					expect(row.properties["note"]).toBe(`note-${originalIndex}`);
					expect(row.properties["metadata"]).toEqual({ sourceIndex: originalIndex });
				}
			}),
		testTimeout,
	);

	test.effect(
		"globally redistributes a dense collection when local ranks cannot fit a move",
		() =>
			Effect.gen(function* () {
				const ordering = yield* CollectionOrderingService;
				const fixture = yield* makeFixture({ rankStep: 1, memberCount: 620 });
				const anchor = fixture.memberIds[310];
				const moving = fixture.memberIds[619];
				const first = fixture.memberIds[0];
				assert(anchor && moving && first);
				const revision = yield* orderRevision(fixture.collectionId);
				const result = yield* ordering.reorder(
					currentUser(ownerId),
					reorderInput(fixture.collectionId, moving, revision, { kind: "after", entityId: anchor }),
				);
				const expectedOrder = [
					...fixture.memberIds.slice(0, 311),
					moving,
					...fixture.memberIds.slice(311, 619),
				];
				expect(yield* orderedMemberIds(fixture.collectionId)).toEqual(expectedOrder);
				expect(result.orderRevision).toBeGreaterThan(revision);
				const rows = yield* membershipRows(fixture.collectionId);
				const ranks = rows.map(({ properties }) => rankOf(properties));
				expect(new Set(ranks).size).toBe(rows.length);
				expect(ranks.every(Number.isSafeInteger)).toBe(true);
				const firstRow = rows.find((row) => row.sourceEntityId === first);
				assert(firstRow);
				expect(rankOf(firstRow.properties)).not.toBe(0);
			}),
		testTimeout,
	);

	test.effect(
		"invalidates a captured revision after membership deletion",
		() =>
			Effect.gen(function* () {
				const ordering = yield* CollectionOrderingService;
				const session = yield* DatabaseSession;
				const fixture = yield* makeFixture({ memberCount: 3 });
				const [deleted, remaining] = fixture.memberIds;
				assert(deleted && remaining);
				const revision = yield* orderRevision(fixture.collectionId);
				yield* session.run((db) =>
					db
						.delete(tables.relationship)
						.where(
							and(
								eq(tables.relationship.userId, ownerId),
								eq(tables.relationship.targetEntityId, fixture.collectionId),
								eq(tables.relationship.sourceEntityId, deleted),
							),
						),
				);
				expect(yield* orderRevision(fixture.collectionId)).toBe(revision + 1);
				assertExitFails(
					yield* Effect.exit(
						ordering.reorder(
							currentUser(ownerId),
							reorderInput(fixture.collectionId, remaining, revision, { kind: "end" }),
						),
					),
					new CollectionConflict({ reason: { code: "order-stale" } }),
				);
			}),
		testTimeout,
	);

	test.effect(
		"invalidates a captured revision when member deletion cascades",
		() =>
			Effect.gen(function* () {
				const ordering = yield* CollectionOrderingService;
				const session = yield* DatabaseSession;
				const fixture = yield* makeFixture({ memberCount: 3 });
				const [deleted, remaining] = fixture.memberIds;
				assert(deleted && remaining);
				const revision = yield* orderRevision(fixture.collectionId);
				yield* session.run((db) => db.delete(tables.entity).where(eq(tables.entity.id, deleted)));
				expect(yield* orderRevision(fixture.collectionId)).toBe(revision + 1);
				expect(yield* orderedMemberIds(fixture.collectionId)).not.toContain(deleted);
				assertExitFails(
					yield* Effect.exit(
						ordering.reorder(
							currentUser(ownerId),
							reorderInput(fixture.collectionId, remaining, revision, { kind: "end" }),
						),
					),
					new CollectionConflict({ reason: { code: "order-stale" } }),
				);
			}),
		testTimeout,
	);

	test.effect(
		"ignores plugin-owned member-of lookalikes when maintaining kernel order revisions",
		() =>
			Effect.gen(function* () {
				const session = yield* DatabaseSession;
				const fixture = yield* makeFixture({ memberCount: 2 });
				const member = fixture.memberIds[0];
				assert(member);
				const pluginId = PluginId.make(`ordering-plugin-${yield* randomUuid}`);
				const relationshipId = RelationshipId.make(`plugin-membership-${yield* randomUuid}`);
				yield* session.run((db) =>
					db
						.insert(tables.plugin)
						.values({ id: pluginId, status: "inactive", packageId: testPluginPackageId() }),
				);
				const revision = yield* orderRevision(fixture.collectionId);
				yield* session.run((db) =>
					db
						.insert(tables.relationship)
						.values({
							userId: ownerId,
							id: relationshipId,
							sourceEntityId: member,
							relationshipSchemaSlug: "member-of",
							targetEntityId: fixture.collectionId,
							relationshipSchemaPluginId: pluginId,
							properties: { rank: -10, note: "plugin-owned" },
						}),
				);
				expect(yield* orderRevision(fixture.collectionId)).toBe(revision);
				yield* session.run((db) =>
					db
						.update(tables.relationship)
						.set({ properties: { rank: 10, note: "plugin-updated" } })
						.where(eq(tables.relationship.id, relationshipId)),
				);
				expect(yield* orderRevision(fixture.collectionId)).toBe(revision);
				yield* session.run((db) =>
					db.delete(tables.relationship).where(eq(tables.relationship.id, relationshipId)),
				);
				expect(yield* orderRevision(fixture.collectionId)).toBe(revision);
			}),
		testTimeout,
	);
});
