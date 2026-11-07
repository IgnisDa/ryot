import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import { EntityId } from "@ryot-app/contract/schema/brands";
import { Effect, Schema } from "effect";
import { DurableClock } from "effect/workflow";

import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { EntitiesRepository } from "#modules/entities/repository";
import { DatabaseSession } from "#platform/db/session";
import { makeActivity } from "#platform/workflow/scope";

import { admitPopulation } from "./population-admission";
import type { ProviderEntityPopulationPayload } from "./population-job";

const MAX_WAIT_MS = 15_000;

/** The request's populated entity, or null while it is still running. */
export const readEntityPopulation = Effect.fn("readEntityPopulation")(function* (requestId: string) {
	const requests = yield* EnrichmentRequests;
	const repository = yield* EntitiesRepository;
	const own = yield* requests.get(requestId);
	const row = own?.joinedTo ? yield* requests.get(own.joinedTo) : own;
	if (!row || row.state === "failed" || row.state === "cancelled") {
		return yield* new SandboxRunError({
			message: "Provider population failed",
			kind: row?.failureKind ?? "infrastructure",
		});
	}
	if (row.state !== "succeeded" || row.entityId === null) {
		return null;
	}
	const found = yield* repository.getById(EntityId.make(row.entityId));
	if (!found) {
		return yield* new SandboxRunError({
			kind: "invalid-input",
			message: "Populated provider entity is unavailable",
		});
	}
	return found;
});

/** A workflow's durable wait for a population job: it asks once, then reads the request's outcome. */
export const awaitEntityPopulation = Effect.fn("awaitEntityPopulation")(function* (
	payload: ProviderEntityPopulationPayload,
) {
	const session = yield* DatabaseSession;
	yield* makeActivity({
		error: SandboxRunError,
		name: `ensure-population-request-${payload.executionId}`,
		execute: session.transaction(admitPopulation(payload)).pipe(
			Effect.asVoid,
			Effect.mapError((error) => toSandboxRunError(error, "infrastructure")),
		),
	});
	for (let observation = 0; ; observation += 1) {
		const entity = yield* makeActivity({
			error: SandboxRunError,
			success: Schema.NullOr(ListedEntity),
			name: `population-result-${payload.executionId}:${observation}`,
			execute: readEntityPopulation(payload.executionId).pipe(
				Effect.mapError((error) => toSandboxRunError(error, "infrastructure")),
			),
		});
		if (entity !== null) {
			return entity;
		}
		yield* DurableClock.sleep({
			inMemoryThreshold: 0,
			duration: Math.min(1000 * 2 ** observation, MAX_WAIT_MS),
			name: `population-wait-${payload.executionId}:${observation}`,
		});
	}
});
