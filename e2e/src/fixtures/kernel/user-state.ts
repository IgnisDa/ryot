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

import type { Client } from "./auth";
import { executeRyotQL, requireRyotQLValue } from "./ryotql";

type MergeUserStateBody = ContractPayload<"userState", "mergeUserState">;

type RelationshipRoot = { schema: string; sourceSchema: string; targetSchema: string };

const aggregateCount = (result: { data: Record<string, unknown> }, key: string) => {
	const value = result.data[key];
	if (!value || typeof value !== "object" || !("type" in value) || value.type !== "aggregate") {
		return 0;
	}
	const items = "items" in value && Array.isArray(value.items) ? value.items : [];
	const item = items[0];
	return item ? Number(requireRyotQLValue(item, "count")) : 0;
};

export const mergeUserState = (client: Client, payload: MergeUserStateBody) =>
	client.call((c) => c.userState.mergeUserState({ payload }));

export const clearEntityUserState = (client: Client, entityId: string) =>
	client.call((c) => c.userState.clearUserState({ params: { entityId: EntityId.make(entityId) } }));

export const queryUserEntityStateCounts = (input: {
	client: Client;
	entityId: string;
	eventSchemaSlugs: readonly [string, ...string[]];
	entitySchemaSlugs: readonly [string, ...string[]];
	relationships: readonly [RelationshipRoot, ...RelationshipRoot[]];
}) =>
	Effect.gen(function* () {
		const eventCountDocument = (filter: { entityId?: string; sessionEntityId?: string }) => {
			const history = eventHistoryRecipe({
				limit: 1,
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
								where: and(
									eq(
										column(relationshipTable, "relationshipSchemaSlug"),
										literal(relationship.schema),
									),
									eq(column(source, "id"), literal(input.entityId)),
									eq(column(source, "entitySchemaSlug"), literal(relationship.sourceSchema)),
									eq(column(target, "entitySchemaSlug"), literal(relationship.targetSchema)),
								),
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
