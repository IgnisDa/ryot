import type { DbError } from "@ryot-app/contract/errors";
import { sql } from "drizzle-orm";
import { Context, Duration, Effect, Layer, Schema } from "effect";

import { broadcastStatement } from "#platform/broadcast";
import { DatabaseSession } from "#platform/db/session";
import { job } from "#schema/tables/jobs";

export const jobWakeTopic = "job";

export type JobPayloadSchema = Schema.Top & Schema.ConstraintCodec<unknown, unknown>;

export interface JobKind<Payload extends JobPayloadSchema = JobPayloadSchema> {
	readonly name: string;
	readonly payload: Payload;
	readonly concurrency: number;
	readonly maxAttempts: number;
	readonly backoff: Duration.Duration;
}

export const makeJobKind = <Payload extends JobPayloadSchema>(
	name: string,
	options: {
		readonly payload: Payload;
		readonly concurrency?: number;
		readonly maxAttempts?: number;
		readonly backoff?: Duration.Input;
	},
): JobKind<Payload> => ({
	name,
	payload: options.payload,
	concurrency: options.concurrency ?? 1,
	maxAttempts: options.maxAttempts ?? 5,
	backoff: Duration.fromInputUnsafe(options.backoff ?? Duration.seconds(10)),
});

export type EnqueueOptions = {
	readonly id?: string;
	readonly key?: string;
	readonly runAt?: Date;
	readonly userId?: string;
	readonly priority?: number;
};

export class JobQueue extends Context.Service<JobQueue>()(
	"@ryot-app/kernel-backend/platform/jobs/queue/JobQueue",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			// Joins the caller's transaction, so the job exists exactly when the write that queued it
			// commits, and the notification is delivered at that commit.
			const enqueue = Effect.fn("JobQueue.enqueue")(function* <Payload extends JobPayloadSchema>(
				kind: JobKind<Payload>,
				payload: Payload["Type"],
				options: EnqueueOptions = {},
			): Effect.fn.Return<boolean, DbError | Schema.SchemaError> {
				const encoded = yield* Schema.encodeUnknownEffect(Schema.toCodecJson(kind.payload))(
					payload,
				);
				const inserted = yield* session.run((db) =>
					db
						.insert(job)
						.values({
							attempts: 0,
							kind: kind.name,
							status: "queued",
							payload: encoded,
							key: options.key ?? null,
							maxAttempts: kind.maxAttempts,
							userId: options.userId ?? null,
							priority: options.priority ?? 0,
							id: options.id ?? crypto.randomUUID(),
							...(options.runAt === undefined ? {} : { runAt: options.runAt }),
						})
						// A queued job under the same key, or one already holding this ID, does the same work.
						.onConflictDoNothing()
						.returning({ id: job.id }),
				);
				if (inserted.length === 0) {
					return false;
				}
				yield* session.run((db) => db.execute(broadcastStatement(jobWakeTopic, kind.name)));
				return true;
			});
			const pruneFailed = Effect.fn("JobQueue.pruneFailed")(function* (limit: number) {
				yield* session.run((db) =>
					db.execute(
						sql`delete from ${job} where ${job.id} in (
							select ${job.id} from ${job}
							where ${job.status} = 'failed' and ${job.updatedAt} < now() - interval '7 days'
							order by ${job.updatedAt} limit ${limit}
						)`,
					),
				);
			});
			return { enqueue, pruneFailed };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
