import { DbError } from "@ryot-app/contract/errors";
import { UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Layer, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow } from "#modules/mutations/workflow-dispatch";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { DatabaseSession } from "#platform/db/session";
import { asIndependentWorkflowRoot } from "#platform/workflow/scope";

import { BackgroundWorkInput } from "./model";
import {
	BackgroundWorkRepository,
	backgroundWorkScopeIdentity,
	type BackgroundWorkScopeKey,
} from "./repository";

export const BackgroundWorkWorkflow = Workflow.make("BackgroundWorkWorkflow", {
	error: DbError,
	success: Schema.Void,
	idempotencyKey: ({ id }) => id,
	payload: Schema.Struct({ id: Schema.String }),
});

export class BackgroundWorkService extends Context.Service<BackgroundWorkService>()(
	"BackgroundWorkService",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const repository = yield* BackgroundWorkRepository;
			const references = yield* SandboxWorkflowReferenceRepository;
			const receipts = yield* MutationReceipts.make;
			const engine = yield* WorkflowEngine;
			const admit = Effect.fn("BackgroundWorkService.admit")(function* (
				input: BackgroundWorkInput,
			) {
				yield* session.requireTransaction.pipe(
					Effect.mapError(
						() => new DbError({ message: "Background admission requires a transaction" }),
					),
				);
				const { execution, accountGeneration: account } = input;
				const pin = execution.pluginRevision;
				if (
					!pin ||
					execution.resolutionMode !== "exact" ||
					execution.lane !== "background" ||
					execution.subject.type !==
						(input.purpose === "user-script" ? "user" : "event-projection") ||
					!("accountGeneration" in execution.subject) ||
					execution.subject.accountGeneration.token !== account.token ||
					execution.subject.accountGeneration.userId !== account.userId ||
					execution.subject.userId !== account.userId ||
					execution.grants ||
					execution.initialization
				) {
					return yield* new DbError({
						message: "Background work requires exact purpose-bound user authority",
					});
				}
				yield* admitWorkflow(receipts, BackgroundWorkWorkflow, account, input.id);
				yield* references.lockIngestionShared();
				const payload = yield* Schema.encodeUnknownEffect(JsonValue)(input).pipe(
					Effect.mapError(() => new DbError({ message: "Invalid background input" })),
				);
				const status = yield* repository.request({
					payload,
					id: input.id,
					key: input.key,
					pluginId: pin.id,
					status: "queued",
					scope: input.scope,
					purpose: input.purpose,
					userId: account.userId,
					accountToken: account.token,
					inputHash: sha256Hex(stableStringify(payload)),
				});
				if (status === "queued" || status === "running") {
					yield* references
						.registerInTransaction({
							pluginId: pin.id,
							executionId: input.id,
							expectedRevision: pin,
							userId: account.userId,
							scriptId: execution.scriptId,
							contentHash: input.contentHash,
						})
						.pipe(Effect.mapError((error) => new DbError({ message: error.message })));
				}
				return input.id;
			});
			const settle = Effect.fn("BackgroundWorkService.settle")(function* (
				id: string,
				status: "succeeded" | "failed",
				error: string | null = null,
			) {
				yield* session.requireTransaction.pipe(
					Effect.mapError(
						() => new DbError({ message: "Background settlement requires a transaction" }),
					),
				);
				const changed = yield* repository.settle(id, status, error?.slice(0, 8192) ?? null);
				yield* references.release(id);
				return changed;
			});
			const finish = (id: string, status: "succeeded" | "failed", error: string | null = null) =>
				session
					.transaction(settle(id, status, error))
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			const launch = Effect.fn("BackgroundWorkService.launch")(function* (job: {
				id: string;
				userId: string;
				accountToken: string;
			}) {
				const rejected = yield* receipts
					.registerWorkflow(
						{ token: job.accountToken, userId: UserId.make(job.userId) },
						BackgroundWorkWorkflow._tag,
						job.id,
					)
					.pipe(
						Effect.as(null),
						Effect.catchTag("DbError", (error) =>
							finish(job.id, "failed", error.message).pipe(Effect.as(error)),
						),
					);
				if (rejected) {
					return rejected;
				}
				yield* engine
					.execute(BackgroundWorkWorkflow, {
						discard: true,
						executionId: job.id,
						payload: { id: job.id },
					})
					.pipe(asIndependentWorkflowRoot);
				yield* repository.dispatched(job.id);
				return null;
			});
			const dispatchScope = Effect.fn("BackgroundWorkService.dispatchScope")(function* (
				key: BackgroundWorkScopeKey,
			) {
				yield* session.requireRoot.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
				let failure: DbError | null = null;
				for (;;) {
					const head = yield* session
						.transaction(
							Effect.gen(function* () {
								yield* repository.lockScope(key);
								const current = yield* repository.running(key);
								if (
									current?.expiredAt === null &&
									current.workflowStatus !== "failed" &&
									current.workflowStatus !== "succeeded"
								) {
									return current.job;
								}
								if (current) {
									yield* settle(
										current.job.id,
										"failed",
										"Background workflow ended before settlement",
									);
								}
								const claimed = yield* repository.claim(key);
								return claimed ? yield* repository.get(claimed) : null;
							}),
						)
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
					if (!head) {
						break;
					}
					const error = yield* launch(head);
					if (!error) {
						break;
					}
					failure ??= error;
				}
				if (failure) {
					return yield* failure;
				}
				return undefined;
			});
			const dispatch = Effect.fn("BackgroundWorkService.dispatch")(function* (id: string) {
				const job = yield* repository.get(id);
				if (job) {
					yield* dispatchScope(job);
				}
			});
			const start = Effect.fn("BackgroundWorkService.start")(function* (id: string) {
				const row = yield* repository.start(id);
				if (!row) {
					return null;
				}
				return yield* Schema.decodeUnknownEffect(BackgroundWorkInput)(row.payload).pipe(
					Effect.mapError(() => new DbError({ message: "Invalid persisted background job" })),
				);
			});
			const recover = Effect.fn("BackgroundWorkService.recover")(function* () {
				const keys = new Map<string, BackgroundWorkScopeKey>();
				for (const key of yield* repository.pending()) {
					keys.set(backgroundWorkScopeIdentity(key), key);
				}
				for (const key of keys.values()) {
					yield* dispatchScope(key).pipe(
						Effect.catchTag("DbError", (error) =>
							Effect.logWarning("Background dispatch failed", error.message),
						),
					);
				}
			});
			return {
				admit,
				start,
				settle,
				finish,
				recover,
				dispatch,
				lockAccount: receipts.admitAccount,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(
			Layer.merge(BackgroundWorkRepository.layer, SandboxWorkflowReferenceRepository.layer),
		),
	);
}
