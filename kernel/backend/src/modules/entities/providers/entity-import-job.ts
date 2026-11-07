import { toSandboxRunError } from "@ryot-app/contract/errors";
import { ListedEntity } from "@ryot-app/contract/modules/entities/schemas";
import type { EventSchemaSlug } from "@ryot-app/contract/schema/brands";
import { and, eq } from "drizzle-orm";
import { Cause, Clock, Duration, Effect, type Exit, Layer, Option, Schema } from "effect";
import { DurableClock } from "effect/workflow";

import { childLifecycleCommand } from "#modules/automations/lifecycle/command";
import { EventsService } from "#modules/events/service";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue, makeJobKind } from "#platform/jobs/queue";
import { type JobContext, registerJobHandler } from "#platform/jobs/worker";
import {
	type ProviderImportPhase,
	recordProviderImportBodyOutcome,
	recordProviderImportBodySettled,
	recordProviderImportBodyStarted,
	recordProviderImportPhaseAttempt,
} from "#platform/observability/runtime-metrics";
import { TransientValues } from "#platform/transient-values";
import { WorkflowExecutionNotifications } from "#platform/workflow/execution-notifications";
import { makeActivity } from "#platform/workflow/scope";
import { job } from "#schema/tables/jobs";

import { EntityImportWorkflowOperations } from "./operations-workflow";
import { admitPopulation } from "./population-admission";
import { readEntityPopulation } from "./population-await";
import { ProviderEntityImportWorkflowPayload } from "./schemas";

const EntityImportStage = Schema.Literals(["population", "provider-import-automation", "entry-event"]);

export class EntityImportError extends Schema.TaggedError<
	EntityImportError,
	{ readonly brand: unique symbol }
>()("EntityImportError", { message: Schema.String, stage: EntityImportStage }) {}

export const EntityImportJob = makeJobKind("entity-import", {
	maxAttempts: 3,
	backoff: Duration.seconds(5),
	payload: ProviderEntityImportWorkflowPayload,
});

/** Who a settled import tells: long polls listen under this name. */
export const entityImportIdentity = (executionId: string) => ({
	executionId,
	workflowName: EntityImportJob.name,
});

const EntityImportOutcome = Schema.Union([
	Schema.TaggedStruct("completed", { entity: ListedEntity }),
	Schema.TaggedStruct("failed", { message: Schema.String, stage: EntityImportStage }),
	Schema.TaggedStruct("cancelled", {}),
]);
type EntityImportOutcome = typeof EntityImportOutcome.Type;

const OutcomeJson = Schema.fromJsonString(Schema.toCodecJson(EntityImportOutcome));
const outcomeKey = (executionId: string) => `entity-import-outcome/${executionId}`;
const entryEventKey = (executionId: string) => `entity-import-entry-event/${executionId}`;
const OUTCOME_TTL = Duration.days(7);

/**
 * Stores what a person or a waiting workflow reads once the job row has gone. The first outcome stands, so an
 * attempt still running when its import is cancelled cannot replace the cancellation.
 */
export const storeEntityImportOutcome = Effect.fnUntraced(function* (
	executionId: string,
	outcome: EntityImportOutcome,
) {
	const encoded = yield* Schema.encodeEffect(OutcomeJson)(outcome).pipe(Effect.orDie);
	yield* (yield* TransientValues).setIfAbsent(outcomeKey(executionId), encoded, OUTCOME_TTL);
});

type EntityImportState = EntityImportOutcome | { readonly _tag: "queued" | "running" };

const isSettled = (state: EntityImportState): state is EntityImportOutcome =>
	state._tag !== "queued" && state._tag !== "running";

/**
 * An import's state. The job row goes only after its outcome is stored, so reading the row first never
 * mistakes a finished import for a cancelled one. An import with neither lost its job with its account.
 */
export const readEntityImport = Effect.fn("readEntityImport")(function* (executionId: string) {
	const session = yield* DatabaseSession;
	const [row] = yield* session.run((db) =>
		db
			.select({ error: job.error, status: job.status })
			.from(job)
			.where(and(eq(job.id, executionId), eq(job.kind, EntityImportJob.name))),
	);
	if (row?.status === "failed") {
		return {
			_tag: "failed",
			stage: "population",
			message: row.error ?? "Entity import failed",
		} satisfies EntityImportState;
	}
	if (row) {
		return { _tag: row.status } satisfies EntityImportState;
	}
	const stored = yield* (yield* TransientValues).get(outcomeKey(executionId));
	return stored === null
		? ({ _tag: "cancelled" } satisfies EntityImportState)
		: yield* Schema.decodeEffect(OutcomeJson)(stored).pipe(Effect.orDie);
});

const attemptOutcome = (exit: Exit.Exit<unknown, unknown>) => {
	if (exit._tag === "Success") {
		return "success";
	}
	return Cause.hasInterruptsOnly(exit.cause) ? "interrupted" : "failure";
};

const measureImportPhase = <A, R>(
	phase: ProviderImportPhase,
	effect: Effect.Effect<A, EntityImportError, R>,
) =>
	Effect.flatMap(Clock.currentTimeMillis, (startedAtMs) =>
		Effect.onExit(effect, (exit) =>
			Effect.flatMap(Clock.currentTimeMillis, (finishedAtMs) =>
				recordProviderImportPhaseAttempt({
					phase,
					startedAtMs,
					finishedAtMs,
					outcome: attemptOutcome(exit),
				}),
			),
		),
	);

// A retried attempt must not create the event again, and events carry no natural key to find it by.
const recordEntryEvent = Effect.fnUntraced(function* (
	payload: ProviderEntityImportWorkflowPayload,
	entityId: ListedEntity["id"],
	eventSchemaSlug: EventSchemaSlug,
	context: JobContext,
) {
	const transient = yield* TransientValues;
	const failure = (message: string) => new EntityImportError({ message, stage: "entry-event" });
	const key = entryEventKey(context.id);
	if (
		context.attempt > 1 &&
		(yield* transient.get(key).pipe(Effect.mapError((error) => failure(error.message)))) !== null
	) {
		return;
	}
	const result = yield* (yield* EventsService)
		.create({
			userId: payload.entityScope.userId,
			payload: [{ entityId, properties: {}, eventSchemaSlug }],
			command: { ...childLifecycleCommand(payload.command, "entry-event"), writeContext: null },
		})
		.pipe(Effect.mapError((error) => failure(error.message)));
	if (result.failure !== null) {
		return yield* failure(result.failure.reason.code);
	}
	yield* transient
		.set(key, "created", OUTCOME_TTL)
		.pipe(Effect.mapError((error) => failure(error.message)));
});

const awaitPopulation = Effect.fnUntraced(function* (payload: ProviderEntityImportWorkflowPayload) {
	const session = yield* DatabaseSession;
	const requestId = `${payload.executionId}-provider-population`;
	yield* session
		.transaction(
			admitPopulation({
				level: "base",
				mode: "ensure",
				command: payload.command,
				executionId: requestId,
				pluginId: payload.pluginId,
				providerId: payload.providerId,
				externalId: payload.externalId,
				entityScope: payload.entityScope,
				entitySchemaSlug: payload.entitySchemaSlug,
			}),
		)
		.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));
	for (let observation = 0; ; observation += 1) {
		const entity = yield* readEntityPopulation(requestId);
		if (entity !== null) {
			return entity;
		}
		yield* Effect.sleep(Duration.millis(Math.min(100 * 2 ** observation, 2_000)));
	}
});

const runImportPhases = Effect.fnUntraced(function* (
	payload: ProviderEntityImportWorkflowPayload,
	context: JobContext,
) {
	const entity = yield* measureImportPhase(
		"population",
		awaitPopulation(payload).pipe(
			Effect.mapError(
				(error) => new EntityImportError({ stage: "population", message: error.message }),
			),
		),
	);
	yield* measureImportPhase(
		"provider-import-automation",
		Effect.flatMap(EntityImportWorkflowOperations, (operations) =>
			operations.completeProviderEntityImport(payload, entity),
		).pipe(
			Effect.mapError(
				(error) =>
					new EntityImportError({ message: error.message, stage: "provider-import-automation" }),
			),
		),
	);
	if (payload.entryEventSchemaSlug !== undefined) {
		yield* measureImportPhase(
			"entry-event",
			recordEntryEvent(payload, entity.id, payload.entryEventSchemaSlug, context),
		);
	}
	return entity;
});

export const runEntityImportJob = Effect.fn("EntityImportJob")(function* (
	payload: ProviderEntityImportWorkflowPayload,
	context: JobContext,
) {
	yield* Effect.annotateCurrentSpan({
		executionId: context.id,
		providerId: payload.providerId,
		externalId: payload.externalId,
		entitySchemaSlug: payload.entitySchemaSlug,
		...(payload.entityScope.userId ? { userId: payload.entityScope.userId } : {}),
	});
	yield* recordProviderImportBodyStarted;
	const outcome = yield* runImportPhases(payload, context).pipe(
		Effect.onExit((exit) =>
			Effect.andThen(
				recordProviderImportBodySettled,
				exit._tag === "Success"
					? recordProviderImportBodyOutcome({ outcome: "success", failureStage: "none" })
					: Option.match(Cause.findErrorOption(exit.cause), {
							onNone: () => Effect.void,
							onSome: (error) =>
								recordProviderImportBodyOutcome({ outcome: "failure", failureStage: error.stage }),
						}),
			),
		),
		Effect.map((entity): EntityImportOutcome => ({ entity, _tag: "completed" })),
		Effect.catchTag("EntityImportError", (error) =>
			Effect.succeed<EntityImportOutcome>({
				_tag: "failed",
				stage: error.stage,
				message: error.message,
			}),
		),
	);
	yield* storeEntityImportOutcome(context.id, outcome);
	yield* (yield* ScriptExecutionService).releaseWorkflowRegistration(context.id);
	yield* (yield* WorkflowExecutionNotifications).publish(entityImportIdentity(context.id));
});

export const EntityImportJobLive = Layer.unwrap(
	Effect.map(AppConfig, (config) =>
		registerJobHandler(
			{ ...EntityImportJob, concurrency: config.sandbox.importConcurrency },
			runEntityImportJob,
		),
	),
);

/** Queues behind any import a person asked for, because a bulk import is not waiting on a screen. */
const WORKFLOW_IMPORT_PRIORITY = 1_000;

const MAX_WAIT_MS = 15_000;

/** A workflow's durable wait for an import: it queues the job once, then reads the import's state. */
export const awaitEntityImport = Effect.fn("awaitEntityImport")(function* (
	payload: ProviderEntityImportWorkflowPayload,
) {
	const failure = (error: { readonly message: string }) =>
		new EntityImportError({ stage: "population", message: error.message });
	const session = yield* DatabaseSession;
	const jobs = yield* JobQueue;
	const admission = yield* AccountAdmission.make;
	const executionId = payload.executionId;
	yield* makeActivity({
		error: EntityImportError,
		name: `queue-entity-import-${executionId}`,
		execute: session
			.transaction(
				Effect.gen(function* () {
					yield* admission.admitAccount(payload.entityScope.userId);
					yield* jobs.enqueue(EntityImportJob, payload, {
						id: executionId,
						priority: WORKFLOW_IMPORT_PRIORITY,
						userId: payload.entityScope.userId,
					});
				}),
			)
			.pipe(Effect.asVoid, Effect.mapError(failure)),
	});
	for (let observation = 0; ; observation += 1) {
		const state = yield* makeActivity({
			error: EntityImportError,
			name: `entity-import-state-${executionId}:${observation}`,
			success: Schema.Union([EntityImportOutcome, Schema.TaggedStruct("pending", {})]),
			execute: readEntityImport(executionId).pipe(
				Effect.map((read) => (isSettled(read) ? read : ({ _tag: "pending" } as const))),
				Effect.mapError(failure),
			),
		});
		if (state._tag === "completed") {
			return state.entity;
		}
		if (state._tag === "failed") {
			return yield* new EntityImportError({ stage: state.stage, message: state.message });
		}
		if (state._tag === "cancelled") {
			return yield* new EntityImportError({ stage: "population", message: "Entity import was cancelled" });
		}
		yield* DurableClock.sleep({
			inMemoryThreshold: 0,
			duration: Math.min(1000 * 2 ** observation, MAX_WAIT_MS),
			name: `entity-import-wait-${executionId}:${observation}`,
		});
	}
});
