import { DbError } from "@ryot-app/contract/errors";
import { CreateEventItem } from "@ryot-app/contract/modules/events/schemas";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import type { genericImportEventIntentSchema } from "@ryot-app/plugin-backend-sdk/imports";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, DateTime, Effect, Layer, Schema } from "effect";

import { eventCreateChanges } from "#modules/changes/changes";
import { toCreateEventsResponse } from "#modules/changes/outcomes";
import { ChangeSets } from "#modules/changes/service";
import { DomainLifecycleCommand } from "#modules/entities/write-context";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { IdempotencyKeys } from "#modules/mutations/idempotency";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue, makeJobKind } from "#platform/jobs/queue";
import { registerJobHandler } from "#platform/jobs/worker";

import {
	IntegrationEventStreamKey,
	IntegrationEventStreamRepository,
} from "./integration-event-stream-repository";

const PendingEvent = Schema.Struct({
	event: CreateEventItem,
	intervalSeconds: Schema.Int,
	command: DomainLifecycleCommand,
	identity: Schema.NonEmptyString,
	fingerprint: Schema.NonEmptyString,
});

const FlushJob = makeJobKind("integration-event-flush", {
	concurrency: 8,
	payload: Schema.Struct({ ...IntegrationEventStreamKey.fields, dueAt: IsoUtcString }),
});

type Coalescing = Exclude<typeof genericImportEventIntentSchema.Type.coalescing, undefined>;

const events = { independent: true, verbatimIdentities: true } as const;

const nextEligibility = (seconds: number) =>
	DateTime.now.pipe(Effect.map((now) => DateTime.toDateUtc(DateTime.add(now, { seconds }))));

export class IntegrationEventWrites extends Context.Service<IntegrationEventWrites>()(
	"@ryot-app/kernel-backend/modules/imports/integration-event-writes/IntegrationEventWrites",
	{
		make: Effect.gen(function* () {
			const streams = yield* IntegrationEventStreamRepository;
			const database = yield* DatabaseSession;
			const queue = yield* JobQueue;
			const changeSets = yield* ChangeSets;
			const keys = yield* IdempotencyKeys.make;
			const accounts = yield* AccountAdmission.make;

			const apply = Effect.fn("IntegrationEventWrites.apply")(function* (input: {
				identity: string;
				coalescing: Coalescing;
				event: CreateEventItem;
				key: IntegrationEventStreamKey;
				command: DomainLifecycleCommand;
			}) {
				const { key, event, command, identity, coalescing } = input;
				const observedAt = DateTime.toDateUtc(DateTime.makeUnsafe(command.occurredAt));
				const select = Effect.gen(function* () {
					yield* accounts.admitAccount(key.userId);
					const unchanged = keys.recordImportItem(
						{ ...command, itemIdentity: identity },
						key.userId,
						"unchanged",
					);
					if (!(yield* streams.lock(key))) {
						return yield* unchanged.pipe(Effect.as(false));
					}
					const runId = command.causation.importRunId;
					if (
						runId &&
						(yield* keys.importItems({ runId, userId: key.userId, itemIdentities: [identity] }))
							.length > 0
					) {
						return false;
					}
					const state = yield* streams.read(key);
					if (
						state &&
						(observedAt < state.observedAt ||
							(observedAt.getTime() === state.observedAt.getTime() &&
								state.fingerprint === null &&
								coalescing.kind === "sample" &&
								state.pending === null))
					) {
						return yield* unchanged.pipe(Effect.as(false));
					}
					if (coalescing.kind === "boundary") {
						return true;
					}
					if (state?.fingerprint === coalescing.fingerprint) {
						yield* streams.write(key, { ...state, observedAt, pending: null });
						return yield* unchanged.pipe(Effect.as(false));
					}
					const now = yield* DateTime.nowAsDate;
					if (!state?.eligibleAt || now >= state.eligibleAt) {
						return true;
					}
					yield* streams.write(key, {
						...state,
						observedAt,
						pending: {
							event,
							command,
							identity,
							fingerprint: coalescing.fingerprint,
							intervalSeconds: coalescing.intervalSeconds,
						} satisfies typeof PendingEvent.Type,
					});
					const payload = { ...key, dueAt: IsoUtcString.make(state.eligibleAt.toISOString()) };
					yield* queue
						.enqueue(FlushJob, payload, {
							userId: key.userId,
							runAt: state.eligibleAt,
							key: stableStringify(payload),
						})
						.pipe(
							Effect.mapError(
								() => new DbError({ message: "Could not schedule an integration event" }),
							),
						);
					return yield* unchanged.pipe(Effect.as(false));
				});
				const written = Effect.gen(function* () {
					const state = coalescing.kind === "boundary" ? yield* streams.read(key) : null;
					yield* streams.write(key, {
						observedAt,
						pending: null,
						fingerprint: coalescing.kind === "sample" ? coalescing.fingerprint : null,
						eligibleAt:
							coalescing.kind === "sample"
								? yield* nextEligibility(coalescing.intervalSeconds)
								: (state?.eligibleAt ?? null),
					});
				});
				return yield* changeSets.commitEventsKeyed(
					eventCreateChanges(key.userId, [event], [identity]),
					command,
					identity,
					{ events, precondition: { written, check: select } },
				);
			});

			const flush = Effect.fn("IntegrationEventWrites.flush")(function* (
				key: typeof FlushJob.payload.Type,
			) {
				const state = yield* streams.read(key);
				if (!state?.pending || state.eligibleAt?.toISOString() !== key.dueAt) {
					return;
				}
				const pending = yield* Schema.decodeUnknownEffect(PendingEvent)(state.pending);
				const command = {
					...pending.command,
					itemIdentity: stableStringify(["integration-event-flush", pending.command.itemIdentity]),
				};
				const select = Effect.gen(function* () {
					yield* accounts.admitAccount(key.userId);
					if (!(yield* streams.lock(key))) {
						return false;
					}
					const current = yield* streams.read(key);
					if (!current?.pending || current.eligibleAt?.toISOString() !== key.dueAt) {
						return false;
					}
					const candidate = yield* Schema.decodeUnknownEffect(PendingEvent)(current.pending).pipe(
						Effect.mapError(() => new DbError({ message: "Invalid pending integration event" })),
					);
					return candidate.identity === pending.identity;
				});
				const written = Effect.gen(function* () {
					yield* streams.write(key, {
						pending: null,
						observedAt: state.observedAt,
						fingerprint: pending.fingerprint,
						eligibleAt: yield* nextEligibility(pending.intervalSeconds),
					});
				});
				const result = toCreateEventsResponse(
					(yield* changeSets.commit(
						eventCreateChanges(key.userId, [pending.event], [pending.identity]),
						command,
						{ events, precondition: { written, check: select } },
					)).outcomes,
				);
				if (
					result.failure ||
					result.outcomes.some(({ status }) => status === "skipped_by_policy")
				) {
					yield* database.transaction(
						Effect.gen(function* () {
							if (yield* select) {
								yield* streams.write(key, { ...state, pending: null });
							}
						}),
					);
					if (result.failure) {
						yield* Effect.logWarning("Deferred integration event was rejected").pipe(
							Effect.annotateLogs({ ...key, reason: result.failure.reason.code }),
						);
					}
				}
			});
			return { apply, flush };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(IntegrationEventStreamRepository.layer),
	);
}

export const IntegrationEventFlushJobLive = registerJobHandler(FlushJob, (key) =>
	Effect.gen(function* () {
		yield* (yield* IntegrationEventWrites).flush(key);
	}),
);
