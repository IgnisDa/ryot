import { Effect } from "effect";

import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { populationRequestPin } from "#modules/entities/population-trigger";
import { JobQueue } from "#platform/jobs/queue";

import { EntityPopulationJob, type ProviderEntityPopulationPayload } from "./population-job";

/**
 * Records a population request and queues its job in the caller's transaction. A request that joins a compatible active
 * one needs no job, because that one's outcome settles it.
 */
export const admitPopulation = Effect.fn("admitPopulation")(function* (
	payload: ProviderEntityPopulationPayload,
	options: {
		readonly retryOf?: string;
		readonly inputHash?: string;
		readonly entityId?: null | Parameters<EnrichmentRequests["Service"]["ensure"]>[0]["entityId"];
	} = {},
) {
	const requests = yield* EnrichmentRequests;
	const jobs = yield* JobQueue;
	const requester = payload.command.accountUserId;
	const row = yield* requests.ensure({
		payload,
		requester,
		language: null,
		level: payload.level,
		id: payload.executionId,
		operation: "population",
		pluginId: payload.pluginId,
		populationMode: payload.mode,
		providerId: payload.providerId,
		externalId: payload.externalId,
		cooldown: payload.manualRefresh,
		entityId: options.entityId ?? null,
		entitySchemaSlug: payload.entitySchemaSlug,
		populationPin: populationRequestPin(payload.command),
		scopeUserId: payload.entityScope.type === "user" ? payload.entityScope.userId : null,
		...(options.inputHash === undefined ? {} : { inputHash: options.inputHash }),
		...(options.retryOf === undefined ? {} : { retryOf: options.retryOf }),
	});
	if (row.joinedTo === null && row.state === "queued" && row.id === payload.executionId) {
		yield* jobs.enqueue(
			EntityPopulationJob,
			{ requestId: row.id },
			{
				key: row.id,
				...(requester === null ? {} : { userId: requester }),
				priority: payload.command.causation.lane === "interactive" ? 0 : 1,
			},
		);
	}
	return row;
});
