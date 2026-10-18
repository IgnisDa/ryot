import type { ContractPayload } from "@ryot-app/contract/client";
import { EntityId } from "@ryot-app/contract/schema/brands";
import {
	aggregate,
	and,
	column,
	document,
	eq,
	join,
	literal,
	measure,
	table,
} from "@ryot-app/ryotql";
import { eventHistoryRecipe } from "@ryot-app/ryotql-recipes/events";
import { Effect } from "effect";

import { requirePresent } from "~/support/assertions";
import { nowIso } from "~/support/time";

import type { Client } from "./auth";
import { executeRyotQL, requireRyotQLValue } from "./ryotql";

type RelationshipRoot = { schema: string; sourceSchema: string; targetSchema: string };

type MergeEntityUserDataBody = Omit<
	ContractPayload<"entityUserData", "mergeEntityUserData">,
	"submittedAt" | "idempotencyKey"
>;
type EntityUserDataSubmission = Pick<
	ContractPayload<"entityUserData", "clearEntityUserData">,
	"submittedAt" | "idempotencyKey"
>;

const aggregateCount = (result: { data: Record<string, unknown> }, key: string) => {
	const value = result.data[key];
	if (!value || typeof value !== "object" || !("type" in value) || value.type !== "aggregate") {
		return 0;
	}
	const items = "items" in value && Array.isArray(value.items) ? value.items : [];
	const item = items[0];
	return item ? Number(requireRyotQLValue(item, "count")) : 0;
};

export const mergeEntityUserData = (
	client: Client,
	payload: MergeEntityUserDataBody,
	submission?: EntityUserDataSubmission,
) => {
	const mutation = submission ?? { submittedAt: nowIso(), idempotencyKey: crypto.randomUUID() };
	return client.call((c) =>
		c.entityUserData.mergeEntityUserData({ payload: { ...payload, ...mutation } }),
	);
};

export const clearEntityUserData = (
	client: Client,
	entityId: string,
	submission?: EntityUserDataSubmission,
) => {
	const mutation = submission ?? { submittedAt: nowIso(), idempotencyKey: crypto.randomUUID() };
	return client.call((c) =>
		c.entityUserData.clearEntityUserData({
			payload: mutation,
			params: { entityId: EntityId.make(entityId) },
		}),
	);
};

export const queryUserEntityStateCounts = (input: {
	client: Client;
	entityId: string;
	eventSchemaSlugs: readonly [string, ...string[]];
	entitySchemaSlugs: readonly [string, ...string[]];
	owner: Parameters<typeof eventHistoryRecipe>[0]["owner"];
	relationships: readonly [RelationshipRoot, ...RelationshipRoot[]];
}) =>
	Effect.gen(function* () {
		const eventCountDocument = (filter: { entityId?: string; sessionEntityId?: string }) => {
			const history = eventHistoryRecipe({
				limit: 1,
				owner: input.owner,
				...filter,
				eventSchemaSlugs: input.eventSchemaSlugs,
				entitySchemaSlugs: input.entitySchemaSlugs,
			});
			const events = requirePresent(history.document.queries.events, "Expected event query");
			return document({
				events: aggregate(events.from, {
					measures: [measure("count", { function: "count" })],
					...(events.where ? { where: events.where } : {}),
					...(events.joins ? { joins: events.joins } : {}),
				}),
			});
		};
		const [entityEvents, sessionEvents, ...relationships] = yield* Effect.all([
			executeRyotQL(input.client, eventCountDocument({ entityId: input.entityId })),
			executeRyotQL(input.client, eventCountDocument({ sessionEntityId: input.entityId })),
			...input.relationships.map((relationship) =>
				executeRyotQL(
					input.client,
					document({
						relationships: (() => {
							const relationshipTable = table("relationship", "relationship");
							const source = table("entity", "source");
							const target = table("entity", "target");
							return aggregate(relationshipTable, {
								measures: [measure("count", { function: "count" })],
								joins: [
									join(
										"inner",
										source,
										eq(column(relationshipTable, "sourceEntityId"), column(source, "id")),
									),
									join(
										"inner",
										target,
										eq(column(relationshipTable, "targetEntityId"), column(target, "id")),
									),
								],
								where: and(
									eq(
										column(relationshipTable, "relationshipSchemaSlug"),
										literal(relationship.schema),
									),
									eq(column(source, "id"), literal(input.entityId)),
									eq(column(source, "entitySchemaSlug"), literal(relationship.sourceSchema)),
									eq(column(target, "entitySchemaSlug"), literal(relationship.targetSchema)),
								),
							});
						})(),
					}),
				),
			),
		]);

		return {
			eventCount: aggregateCount(entityEvents, "events") + aggregateCount(sessionEvents, "events"),
			relationshipCount: relationships.reduce(
				(total, result) => total + aggregateCount(result, "relationships"),
				0,
			),
		};
	});
