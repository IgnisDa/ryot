import { DbError } from "@ryot-app/contract/errors";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { and, count, eq, inArray } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";

import { DomainWriteChecks } from "#modules/entities/write-context";
import { AccountAdmission } from "#modules/mutations/account-admission";
import { PluginRuntimeResolver } from "#modules/plugins/catalog/runtime-resolver";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { DatabaseSession } from "#platform/db/session";
import { JobQueue } from "#platform/jobs/queue";
import { TransientValues } from "#platform/transient-values";
import { job } from "#schema/tables/jobs";

import { preRegisterProviderDetails } from "./details-principal";
import { EntityImportJob, storeEntityImportOutcome } from "./entity-import-job";
import type { ProviderEntityImportWorkflowPayload } from "./schemas";

/** Queued plus running imports one user may hold; later submissions are rejected as retryable. */
export const PROVIDER_IMPORT_USER_BACKLOG_LIMIT = 50;

const importsOf = (userId: UserId) =>
	and(
		eq(job.userId, userId),
		eq(job.kind, EntityImportJob.name),
		inArray(job.status, ["queued", "running"]),
	);

export class ProviderImportAdmission extends Context.Service<ProviderImportAdmission>()(
	"@ryot-app/kernel-backend/modules/entities/providers/admission/ProviderImportAdmission",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const jobs = yield* JobQueue;
			const sandbox = yield* ScriptExecutionService;
			const runtime = yield* PluginRuntimeResolver;
			const checks = yield* DomainWriteChecks;
			const admission = yield* AccountAdmission.make;
			const transient = yield* TransientValues;

			const submit = Effect.fn("ProviderImportAdmission.submit")(function* (input: {
				userId: UserId;
				payload: ProviderEntityImportWorkflowPayload;
			}) {
				if (input.payload.command.accountUserId !== input.userId) {
					return yield* new DbError({
						message: "Provider import account authority is unavailable",
					});
				}
				const executionId = input.payload.executionId;
				const pin = yield* preRegisterProviderDetails(
					{ sandbox, pluginRuntime: runtime },
					{
						executionId,
						userId: input.userId,
						accountUserId: input.userId,
						pluginId: input.payload.pluginId,
						providerId: input.payload.providerId,
					},
				).pipe(Effect.mapError((error) => new DbError({ message: error.message })));
				const outcome = yield* session
					.transaction(
						Effect.gen(function* () {
							yield* runtime.lockCatalog([input.userId]);
							yield* session.acquireUserWriteLock(input.userId);
							yield* admission.admitAccount(input.userId);
							const provider = yield* checks.checkProvider(
								input.payload.providerId,
								definitionOwner(input.payload.pluginId),
							);
							if (
								provider.rootEntitySchemaSlug !== input.payload.entitySchemaSlug ||
								(pin.pluginRevision.scope === "user" && input.payload.entityScope.type !== "user")
							) {
								return yield* new DbError({
									message: "Provider import owner or scope is unavailable",
								});
							}
							const payload = {
								...input.payload,
								command: { ...input.payload.command, writeContext: pin.principal },
							};
							yield* checks
								.check(
									payload.command,
									definitionOwner(payload.pluginId),
									payload.entityScope.type === "user" ? input.userId : null,
									true,
								)
								.pipe(Effect.mapError((error) => new DbError({ message: error.message })));
							const key = stableStringify([
								input.userId,
								payload.providerId,
								payload.entitySchemaSlug,
								payload.externalId,
							]);
							const [existing] = yield* session.run((db) =>
								db
									.select({ id: job.id })
									.from(job)
									.where(and(importsOf(input.userId), eq(job.key, key))),
							);
							if (existing) {
								return { id: existing.id, status: "duplicate" as const };
							}
							const [active] = yield* session.run((db) =>
								db.select({ total: count() }).from(job).where(importsOf(input.userId)),
							);
							const total = active?.total ?? 0;
							if (total >= PROVIDER_IMPORT_USER_BACKLOG_LIMIT) {
								return { status: "backlog-full" as const };
							}
							// A user's next import queues behind their earlier ones and level with everyone else's first.
							yield* jobs
								.enqueue(EntityImportJob, payload, {
									key,
									id: executionId,
									priority: total,
									userId: input.userId,
								})
								.pipe(Effect.catchTag("SchemaError", Effect.die));
							return { id: executionId, status: "queued" as const };
						}),
					)
					.pipe(
						Effect.onError(() =>
							sandbox.releaseWorkflowRegistration(executionId).pipe(Effect.orDie),
						),
					);
				if (outcome.status !== "queued") {
					yield* sandbox.releaseWorkflowRegistration(executionId);
				}
				return outcome;
			});

			/** Removes the job. A running attempt carries on until its next write, which finds the job gone. */
			const cancel = Effect.fn("ProviderImportAdmission.cancel")(function* (input: {
				id: string;
				userId: UserId;
			}) {
				yield* storeEntityImportOutcome(input.id, { _tag: "cancelled" }).pipe(
					Effect.provideService(TransientValues, transient),
				);
				const removed = yield* session.run((db) =>
					db
						.delete(job)
						.where(and(eq(job.id, input.id), importsOf(input.userId)))
						.returning({ id: job.id }),
				);
				if (removed.length > 0) {
					yield* sandbox.releaseWorkflowRegistration(input.id);
				}
			});

			return { cancel, submit };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
