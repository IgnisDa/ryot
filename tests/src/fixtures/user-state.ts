import type { ContractPayload } from "@ryot/contract/client";
import { EntityId } from "@ryot/contract/schema/brands";
import {
	and,
	ascending,
	column,
	document,
	eq,
	field,
	join,
	literal,
	rows,
	table,
} from "@ryot/ryotql";
import { buildEventHistoryDocument } from "@ryot/ryotql-recipes/events";
import { Effect } from "effect";

import type { Client } from "./auth";
import { executeRyotQL } from "./ryotql";

type MergeUserStateBody = ContractPayload<"userState", "mergeUserState">;

type RelationshipRoot = {
	schema: string;
	sourceSchema: string;
	targetSchema: string;
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
		const [entityEvents, sessionEvents, ...relationships] = yield* Effect.all([
			executeRyotQL(
				input.client,
				buildEventHistoryDocument({
					page: 1,
					limit: 1,
					entityId: input.entityId,
					eventSchemaSlugs: input.eventSchemaSlugs,
					entitySchemaSlugs: input.entitySchemaSlugs,
				}),
			),
			executeRyotQL(
				input.client,
				buildEventHistoryDocument({
					page: 1,
					limit: 1,
					sessionEntityId: input.entityId,
					eventSchemaSlugs: input.eventSchemaSlugs,
					entitySchemaSlugs: input.entitySchemaSlugs,
				}),
			),
			...input.relationships.map((relationship) =>
				executeRyotQL(
					input.client,
					document({
						relationships: (() => {
							const relationshipTable = table("relationship", "relationship");
							const source = table("entity", "source");
							const target = table("entity", "target");
							return rows(relationshipTable, {
								limit: 1,
								fields: [field("id", column(relationshipTable, "id"))],
								orderBy: [ascending(column(relationshipTable, "id"))],
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
			eventCount:
				(entityEvents.data.events?.type === "rows" ? entityEvents.data.events.pageInfo.total : 0) +
				(sessionEvents.data.events?.type === "rows" ? sessionEvents.data.events.pageInfo.total : 0),
			relationshipCount: relationships.reduce(
				(count, result) =>
					count +
					(result.data.relationships?.type === "rows"
						? result.data.relationships.pageInfo.total
						: 0),
				0,
			),
		};
	});
