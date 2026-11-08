import type { JsonValue } from "@ryot-app/contract/schema/json";
import { sql } from "drizzle-orm";
import {
	Cause,
	Context,
	Duration,
	Effect,
	Exit,
	FiberSet,
	Layer,
	Queue,
	Schedule,
	Schema,
} from "effect";

import { Broadcast } from "#platform/broadcast";
import { DatabaseSession } from "#platform/db/session";
import { job } from "#schema/tables/jobs";

import { type JobKind, type JobPayloadSchema, jobWakeTopic } from "./queue";

export type JobContext = { readonly id: string; readonly attempt: number };

type JobHandler = {
	readonly kind: JobKind;
	readonly run: (payload: unknown, context: JobContext) => Effect.Effect<void, unknown>;
};

/** The job this fiber runs for, so a write can tell that account retirement removed it. */
export const CurrentJobId = Context.Reference<null | string>(
	"@ryot-app/kernel-backend/platform/jobs/worker/CurrentJobId",
	{ defaultValue: () => null },
);

export class JobHandlers extends Context.Service<JobHandlers>()(
	"@ryot-app/kernel-backend/platform/jobs/worker/JobHandlers",
	{
		make: Effect.sync(() => {
			const handlers = new Map<string, JobHandler>();
			return {
				get: (kind: string) => handlers.get(kind),
				kinds: () => Array.from(handlers.values(), (handler) => handler.kind),
				register: (handler: JobHandler) =>
					handlers.has(handler.kind.name)
						? Effect.die(new Error(`Job kind ${handler.kind.name} is registered twice`))
						: Effect.sync(() => {
								handlers.set(handler.kind.name, handler);
							}),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const registerJobHandler = <Payload extends JobPayloadSchema, E, R>(
	kind: JobKind<Payload>,
	run: (payload: Payload["Type"], context: JobContext) => Effect.Effect<void, E, R>,
) =>
	Layer.effectDiscard(
		Effect.gen(function* () {
			const handlers = yield* JobHandlers;
			const services = yield* Effect.context<R>();
			const decode = Schema.decodeUnknownEffect(Schema.toCodecJson(kind.payload));
			yield* handlers.register({
				kind,
				run: (payload, context) =>
					decode(payload).pipe(
						Effect.flatMap((decoded) => run(decoded, context)),
						Effect.provideContext(services),
					),
			});
		}),
	);

type KindState = {
	readonly kind: string;
	readonly ready: boolean;
	readonly wait_ms: null | string;
};

type ClaimedJob = {
	readonly id: string;
	readonly attempts: number;
	readonly payload: JsonValue;
	readonly max_attempts: number;
};

class JobAttemptsExhausted extends Schema.TaggedError<
	JobAttemptsExhausted,
	{ readonly brand: unique symbol }
>()("JobAttemptsExhausted", {}) {}

const IDLE_RECHECK = Duration.minutes(1);

const backoffMs = (kind: JobKind, attempt: number) =>
	Math.min(
		Duration.toMillis(kind.backoff) * 2 ** (attempt - 1),
		Duration.toMillis(Duration.hours(1)),
	);

const fenced = (row: ClaimedJob) =>
	sql`${job.id} = ${row.id} and ${job.attempts} = ${row.attempts} and ${job.status} = 'running'`;

const errorText = (cause: Cause.Cause<unknown>) => Cause.pretty(cause).slice(0, 4000);

export const JobWorkerLive = Layer.effectDiscard(
	Effect.gen(function* () {
		const broadcast = yield* Broadcast;
		const session = yield* DatabaseSession;
		const handlers = yield* JobHandlers;
		const wake = yield* Queue.sliding<void>(1);
		const fibers = yield* FiberSet.make<void>();
		const running = new Map<string, number>();
		const signal = Queue.offer(wake, undefined);

		yield* session.transaction(
			session.run((db) =>
				Effect.gen(function* () {
					yield* db.execute(sql`delete from ${job} r where r.status = 'running' and r.key is not null
 and exists (select 1 from ${job} q where q.kind = r.kind and q.key = r.key and q.status = 'queued')`);
					yield* db.execute(sql`update ${job} set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
 error = 'Interrupted by backend shutdown', run_at = now(), updated_at = now() where status = 'running'`);
				}),
			),
		);

		const states = session.run((db) =>
			db.execute<KindState>(
				sql`select kind,
					bool_or(run_at <= now()) as ready,
					greatest(0, ceil(extract(epoch from min(run_at) - now()) * 1000))::text as wait_ms
				from ${job} where status = 'queued' group by kind`,
				"objects",
			),
		);

		const claim = (kind: JobKind, limit: number) =>
			session.run((db) =>
				db.execute<ClaimedJob>(
					sql`with next as (
						select id from ${job}
						where kind = ${kind.name}
							and status = 'queued' and run_at <= now()
						order by priority, run_at, id
						limit ${limit}
						for update skip locked
					)
					update ${job} set status = 'running', attempts = ${job.attempts} + 1, error = null,
						updated_at = now()
					from next where ${job.id} = next.id
					returning ${job.id}, ${job.attempts}, ${job.payload}, ${job.maxAttempts} as max_attempts`,
					"objects",
				),
			);

		const remove = (row: ClaimedJob) =>
			session.run((db) => db.execute(sql`delete from ${job} where ${fenced(row)}`));

		const settle = (kind: JobKind, row: ClaimedJob, exit: Exit.Exit<void, unknown>) => {
			if (Exit.isSuccess(exit)) {
				return remove(row);
			}
			if (Cause.hasInterruptsOnly(exit.cause)) {
				return session
					.run((db) =>
						db.execute(
							sql`update ${job} set status = 'queued', run_at = now(), attempts = ${job.attempts} - 1 where ${fenced(row)}`,
						),
					)
					.pipe(
						Effect.catchIf(
							(failure) => failure.constraint === "job_queued_key_unique",
							() => remove(row),
						),
					);
			}
			const error = errorText(exit.cause);
			return row.attempts < row.max_attempts
				? session
						.run((db) =>
							db.execute(
								sql`update ${job} set status = 'queued', error = ${error}, updated_at = now(),
									run_at = now() + ${backoffMs(kind, row.attempts)} * interval '1 millisecond'
								where ${fenced(row)}`,
							),
						)
						.pipe(
							// A job queued under this key while this one ran does the same work.
							Effect.catchIf(
								(failure) => failure.constraint === "job_queued_key_unique",
								() => remove(row),
							),
						)
				: session.run((db) =>
						db.execute(
							sql`update ${job} set status = 'failed', error = ${error}, updated_at = now()
							where ${fenced(row)}`,
						),
					);
		};

		const execute = (handler: JobHandler, row: ClaimedJob) =>
			Effect.gen(function* () {
				const exit = yield* (
					row.attempts > row.max_attempts
						? Effect.fail(new JobAttemptsExhausted({}))
						: handler
								.run(row.payload, { id: row.id, attempt: row.attempts })
								.pipe(Effect.provideService(CurrentJobId, row.id))
				).pipe(Effect.exit);
				if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
					yield* Effect.logWarning("job failed", exit.cause).pipe(
						Effect.annotateLogs({ jobId: row.id, attempt: row.attempts, kind: handler.kind.name }),
					);
				}
				yield* settle(handler.kind, row, exit).pipe(
					Effect.tapError((error) => Effect.logWarning("job settlement failed", error)),
					Effect.retry(Schedule.spaced(Duration.seconds(5))),
				);
			}).pipe(
				Effect.onInterrupt(() => settle(handler.kind, row, Exit.interrupt()).pipe(Effect.ignore)),
				Effect.ensuring(
					Effect.sync(() => {
						running.set(handler.kind.name, (running.get(handler.kind.name) ?? 1) - 1);
					}).pipe(Effect.andThen(signal)),
				),
			);

		const round = Effect.gen(function* () {
			let nextWake = Duration.toMillis(IDLE_RECHECK);
			for (const state of yield* states) {
				const handler = handlers.get(state.kind);
				if (handler === undefined) {
					continue;
				}
				if (!state.ready) {
					nextWake = Math.min(nextWake, Number(state.wait_ms ?? nextWake));
					continue;
				}
				const free = handler.kind.concurrency - (running.get(state.kind) ?? 0);
				if (free <= 0) {
					continue;
				}
				for (const row of yield* claim(handler.kind, free)) {
					running.set(state.kind, (running.get(state.kind) ?? 0) + 1);
					yield* FiberSet.run(fibers, execute(handler, row));
				}
			}
			return nextWake;
		});

		const wakeNow = () => Queue.offerUnsafe(wake, undefined);
		yield* broadcast.subscribe(jobWakeTopic, wakeNow);
		yield* broadcast.onReconnect(wakeNow);

		yield* round.pipe(
			Effect.catchCause((cause) =>
				Effect.logWarning("job round failed", cause).pipe(
					Effect.as(Duration.toMillis(Duration.seconds(5))),
				),
			),
			Effect.flatMap((waitMs) =>
				Queue.take(wake).pipe(Effect.timeoutOption(Duration.millis(waitMs))),
			),
			Effect.forever,
			Effect.forkScoped,
		);
	}),
);
