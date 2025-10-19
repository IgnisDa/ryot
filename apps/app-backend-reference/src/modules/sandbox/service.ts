import { eq, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";

import { requireAccess } from "../../lib/access";
import type { CurrentUserValue } from "../../lib/auth";
import { DbService, schema } from "../../lib/db";
import { SandboxRunError, unknownToMessage } from "../../lib/errors";
import { SandboxService } from "../../lib/sandbox";
import { SandboxRunStatus, type RunSandboxPayload, type SandboxRunResult } from "./schemas";

type SandboxRunRow = typeof schema.sandboxRun.$inferSelect;
const decodeSandboxRunStatus = Schema.decodeUnknownSync(SandboxRunStatus);

const mapRun = (row: SandboxRunRow): SandboxRunResult => ({
	id: row.id,
	runId: row.runId ?? null,
	logs: row.logs ?? null,
	status: decodeSandboxRunStatus(row.status),
	result: row.result ?? null,
	error: row.error ?? null,
	driverName: row.driverName,
	scriptSlug: row.scriptSlug,
	createdAt: row.createdAt.toISOString(),
	updatedAt: row.updatedAt.toISOString(),
});

const dbError = (cause: unknown) => new SandboxRunError({ message: unknownToMessage(cause) });

const runNotFound = (runId: string) =>
	new SandboxRunError({ message: `Sandbox run ${runId} not found` });

export class SandboxApiService extends Effect.Service<SandboxApiService>()("SandboxApiService", {
	effect: Effect.gen(function* () {
		const { db } = yield* DbService;
		const sandbox = yield* SandboxService;

		const updateRun = (runId: string, values: Partial<typeof schema.sandboxRun.$inferInsert>) =>
			Effect.tryPromise({
				try: () =>
					db
						.update(schema.sandboxRun)
						.set({ ...values, updatedAt: sql`now()` })
						.where(eq(schema.sandboxRun.id, runId)),
				catch: dbError,
			}).pipe(Effect.asVoid);

		return {
			get: (user: CurrentUserValue, runId: string) =>
				Effect.tryPromise({
					try: () =>
						db.select().from(schema.sandboxRun).where(eq(schema.sandboxRun.id, runId)).limit(1),
					catch: dbError,
				}).pipe(
					Effect.flatMap(([row]) =>
						requireAccess<SandboxRunRow, SandboxRunError>({
							notFound: () => runNotFound(runId),
							rules: [
								{
									error: () => runNotFound(runId),
									test: (candidate) => candidate.userId === user.id,
								},
							],
						})(row),
					),
					Effect.map(mapRun),
				),
			run: (user: CurrentUserValue, payload: RunSandboxPayload) =>
				Effect.gen(function* () {
					const [row] = yield* Effect.tryPromise({
						try: () =>
							db
								.insert(schema.sandboxRun)
								.values({
									userId: user.id,
									runId: null,
									status: "queued",
									context: payload.context ?? {},
									driverName: payload.driverName,
									scriptSlug: payload.scriptSlug,
								})
								.returning(),
						catch: dbError,
					});
					if (!row) {
						return yield* new SandboxRunError({ message: "Sandbox run insert returned no row" });
					}

					// Direct sandbox demo: intentionally non-durable fire-and-forget background work,
					// lost on restart. The durable path runs through AudibleSandboxQueue instead.
					yield* Effect.gen(function* () {
						yield* updateRun(row.id, { status: "running" });
						const result = yield* sandbox.run({
							context: payload.context ?? {},
							runId: null,
							driverName: payload.driverName,
							scriptSlug: payload.scriptSlug,
							executionId: row.id,
						});
						yield* updateRun(
							row.id,
							result.success
								? { logs: result.logs, result: result.value, status: "completed" }
								: {
										error: result.error,
										logs: result.logs,
										status: "failed",
									},
						);
					}).pipe(
						Effect.catchAll((error) =>
							updateRun(row.id, { status: "failed", error: error.message }),
						),
						Effect.forkDaemon,
					);

					return mapRun(row);
				}),
		};
	}),
}) {}
