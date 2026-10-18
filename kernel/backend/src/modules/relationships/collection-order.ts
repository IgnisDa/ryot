import { DbError } from "@ryot-app/contract/errors";
import {
	CollectionNotFound,
	collectionRankStep,
	type ReorderMembershipBody,
} from "@ryot-app/contract/modules/collections/schemas";
import type { EntityId, UserId } from "@ryot-app/contract/schema/brands";
import { and, asc, desc, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { DatabaseSession } from "#platform/db/session";
import { entity, relationship } from "#schema/tables/entities";

import type { RelationshipIdentityInput } from "./repository";

const rankBoundary = 2 ** 52;
const windowSize = 128;

type Scope = { readonly userId: UserId; readonly collectionId: EntityId };
export const isCollectionMember = (input: RelationshipIdentityInput) =>
	input.scope === "user" &&
	input.relationshipSchemaPluginId === null &&
	input.relationshipSchemaSlug === "member-of";

export const collectionRank = sql<number>`(case when ${relationship.relationshipSchemaSlug} = 'member-of' and ${relationship.relationshipSchemaPluginId} is null then (${relationship.properties} ->> 'rank')::double precision end)`;

const memberWhere = (scope: Scope) =>
	and(
		eq(relationship.userId, scope.userId),
		eq(relationship.targetEntityId, scope.collectionId),
		eq(relationship.relationshipSchemaSlug, "member-of"),
		isNull(relationship.relationshipSchemaPluginId),
	);

const rankBetween = (left: null | number, right: null | number) => {
	if (left === null && right === null) {
		return 0;
	}
	let value: number;
	if (left === null) {
		value = (right ?? 0) - collectionRankStep;
	} else if (right === null) {
		value = left + collectionRankStep;
	} else {
		value = left + Math.floor((right - left) / 2);
	}
	return value > -rankBoundary &&
		value < rankBoundary &&
		(left === null || value > left) &&
		(right === null || value < right)
		? value
		: null;
};

export const makeCollectionOrderPersistence = (session: DatabaseSession["Service"]) => {
	const lock = Effect.fn("RelationshipsRepository.lockCollectionOrders")(function* (
		inputs: ReadonlyArray<RelationshipIdentityInput>,
	) {
		const ids = [
			...new Set(inputs.filter(isCollectionMember).map((input) => input.targetEntityId)),
		].sort();
		if (ids.length === 0) {
			return;
		}
		yield* session.run((db) =>
			db
				.select({ id: entity.id })
				.from(entity)
				.where(
					sql`${entity.id} = any(array[${sql.join(
						ids.map((id) => sql`${id}`),
						sql`, `,
					)}]::text[])`,
				)
				.orderBy(sql`${entity.id} collate "C"`)
				.for("no key update"),
		);
	});
	const selection = { id: relationship.id, rank: collectionRank };
	const findMember = (scope: Scope, entityId: EntityId) =>
		session
			.run((db) =>
				db
					.select(selection)
					.from(relationship)
					.where(and(memberWhere(scope), eq(relationship.sourceEntityId, entityId)))
					.limit(1),
			)
			.pipe(Effect.map((rows) => rows[0] ?? null));
	const neighbors = Effect.fnUntraced(function* (
		scope: Scope,
		destination: ReorderMembershipBody["destination"],
		exclude?: EntityId,
	) {
		const where = and(
			memberWhere(scope),
			exclude === undefined ? undefined : ne(relationship.sourceEntityId, exclude),
		);
		if (destination.kind === "after") {
			const left = yield* findMember(scope, destination.entityId);
			if (!left) {
				return yield* new CollectionNotFound({
					reason: {
						code: "membership-not-found",
						entityId: destination.entityId,
						collectionId: scope.collectionId,
					},
				});
			}
			const [right] = yield* session.run((db) =>
				db
					.select(selection)
					.from(relationship)
					.where(and(where, gt(collectionRank, left.rank)))
					.orderBy(asc(collectionRank), asc(relationship.sourceEntityId))
					.limit(1),
			);
			return { left, right: right ?? null };
		}
		if (destination.kind === "end") {
			const [left] = yield* session.run((db) =>
				db
					.select(selection)
					.from(relationship)
					.where(where)
					.orderBy(desc(collectionRank), desc(relationship.sourceEntityId))
					.limit(1),
			);
			return { right: null, left: left ?? null };
		}
		const right =
			destination.kind === "before"
				? yield* findMember(scope, destination.entityId)
				: ((yield* session.run((db) =>
						db
							.select(selection)
							.from(relationship)
							.where(where)
							.orderBy(asc(collectionRank), asc(relationship.sourceEntityId))
							.limit(1),
					))[0] ?? null);
		if (destination.kind === "before" && !right) {
			return yield* new CollectionNotFound({
				reason: {
					code: "membership-not-found",
					entityId: destination.entityId,
					collectionId: scope.collectionId,
				},
			});
		}
		const left =
			right === null
				? null
				: ((yield* session.run((db) =>
						db
							.select(selection)
							.from(relationship)
							.where(and(where, lt(collectionRank, right.rank)))
							.orderBy(desc(collectionRank), desc(relationship.sourceEntityId))
							.limit(1),
					))[0] ?? null);
		return { left, right };
	});
	const rebalance = Effect.fnUntraced(function* (scope: Scope, pivot: number) {
		const before = yield* session.run((db) =>
			db
				.select(selection)
				.from(relationship)
				.where(and(memberWhere(scope), sql`${collectionRank} <= ${pivot}`))
				.orderBy(desc(collectionRank), desc(relationship.sourceEntityId))
				.limit(windowSize + 1),
		);
		const after = yield* session.run((db) =>
			db
				.select(selection)
				.from(relationship)
				.where(and(memberWhere(scope), gt(collectionRank, pivot)))
				.orderBy(asc(collectionRank), asc(relationship.sourceEntityId))
				.limit(windowSize + 1),
		);
		const rows = [...before.slice(0, windowSize).toReversed(), ...after.slice(0, windowSize)];
		const lower = before[windowSize]?.rank ?? -rankBoundary;
		const upper = after[windowSize]?.rank ?? rankBoundary;
		const step = Math.floor((upper - lower) / (rows.length + 1));
		if (step >= 2) {
			yield* session.run((db) =>
				db.execute(sql`update ${relationship} set properties = jsonb_set(properties, '{rank}', to_jsonb(v.rank)), updated_at = now()
				from (values ${sql.join(
					rows.map(
						(row, index) => sql`(${row.id}::text, ${lower + step * (index + 1)}::double precision)`,
					),
					sql`, `,
				)}) v(id, rank) where ${relationship.id} = v.id`),
			);
			return;
		}
		// A fully dense surrounding window needs collection-wide spacing, not a larger in-memory batch.
		yield* session.run((db) =>
			db.execute(sql`with ranked as (
			select id, row_number() over (order by ${collectionRank}, ${relationship.sourceEntityId}) as n,
			count(*) over () as total from ${relationship} where ${memberWhere(scope)}
		) update ${relationship} set properties = jsonb_set(properties, '{rank}', to_jsonb(
			(-${rankBoundary}::numeric + floor(${2 * rankBoundary}::numeric / (ranked.total + 1)) * ranked.n)::double precision)), updated_at = now()
		from ranked where ${relationship.id} = ranked.id`),
		);
	});
	const allocate = Effect.fnUntraced(function* (
		scope: Scope,
		destination: ReorderMembershipBody["destination"],
		exclude?: EntityId,
	) {
		let pair = yield* neighbors(scope, destination, exclude);
		let rank = rankBetween(pair.left?.rank ?? null, pair.right?.rank ?? null);
		if (rank === null) {
			yield* rebalance(scope, pair.right?.rank ?? pair.left?.rank ?? 0);
			pair = yield* neighbors(scope, destination, exclude);
			rank = rankBetween(pair.left?.rank ?? null, pair.right?.rank ?? null);
		}
		if (rank === null) {
			return yield* new DbError({
				message: "Collection ordering has no representable integer position",
			});
		}
		return rank;
	});
	const prepareCreates = Effect.fnUntraced(
		function* <T extends RelationshipIdentityInput & { properties: Record<string, unknown> }>(
			inputs: ReadonlyArray<T>,
		) {
			const groups = new Map<EntityId, { scope: Scope; count: number }>();
			for (const input of inputs) {
				if (input.scope === "user" && isCollectionMember(input)) {
					const group = groups.get(input.targetEntityId);
					groups.set(input.targetEntityId, {
						count: (group?.count ?? 0) + 1,
						scope: { userId: input.userId, collectionId: input.targetEntityId },
					});
				}
			}
			const ranks = new Map<EntityId, { rank: number; step: number }>();
			const lowest =
				groups.size === 0
					? []
					: yield* session.run((db) =>
							db.execute<{ rank: null | number; collectionId: string }>(
								sql`
			select g.id as "collectionId", m.rank from (values ${sql.join(
				[...groups].map(([id, group]) => sql`(${id}::text, ${group.scope.userId}::text)`),
				sql`, `,
			)}) g(id, user_id)
			left join lateral (select ${collectionRank} as rank from ${relationship}
			where ${relationship.targetEntityId} = g.id and ${relationship.userId} = g.user_id and ${relationship.relationshipSchemaSlug} = 'member-of' and ${relationship.relationshipSchemaPluginId} is null
			order by ${collectionRank}, ${relationship.sourceEntityId} limit 1) m on true`,
								"objects",
							),
						);
			const lowestByCollection = new Map(lowest.map((row) => [row.collectionId, row.rank]));
			for (const [id, group] of groups) {
				const first = lowestByCollection.get(id);
				let rank = first == null ? 0 : first - collectionRankStep;
				let step = Math.min(
					collectionRankStep,
					Math.floor((rank + rankBoundary) / (group.count + 1)),
				);
				if (step < 1 || rank <= -rankBoundary) {
					yield* rebalance(group.scope, rank);
					rank = yield* allocate(group.scope, { kind: "start" });
					step = Math.min(
						collectionRankStep,
						Math.floor((rank + rankBoundary) / (group.count + 1)),
					);
				}
				if (step < 1) {
					return yield* new DbError({ message: "Collection ordering cannot allocate this batch" });
				}
				ranks.set(id, { rank, step });
			}
			return inputs.map((input) => {
				const next = isCollectionMember(input) ? ranks.get(input.targetEntityId) : undefined;
				if (next === undefined) {
					return input;
				}
				const rank = next.rank;
				next.rank -= next.step;
				return { ...input, properties: { ...input.properties, rank } };
			});
		},
		Effect.catchTag(
			"CollectionNotFound",
			(error) =>
				new DbError({ message: `Collection rank allocation failed: ${error.reason.code}` }),
		),
	);
	const move = Effect.fn("RelationshipsRepository.moveCollectionMember")(function* (
		scope: Scope,
		entityId: EntityId,
		destination: ReorderMembershipBody["destination"],
	) {
		const member = yield* findMember(scope, entityId);
		if (!member) {
			return yield* new CollectionNotFound({
				reason: { entityId, code: "membership-not-found", collectionId: scope.collectionId },
			});
		}
		if (
			(destination.kind === "before" || destination.kind === "after") &&
			destination.entityId === entityId
		) {
			return undefined;
		}
		const { left, right } = yield* neighbors(scope, destination, entityId);
		if (
			(left === null || member.rank > left.rank) &&
			(right === null || member.rank < right.rank)
		) {
			return undefined;
		}
		const rank = yield* allocate(scope, destination, entityId);
		yield* session.run((db) =>
			db
				.update(relationship)
				.set({
					properties: sql`jsonb_set(${relationship.properties}, '{rank}', to_jsonb(${rank}::double precision))`,
				})
				.where(eq(relationship.id, member.id)),
		);
		return undefined;
	});
	return { lock, move, prepareCreates };
};
