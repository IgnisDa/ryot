import { DbError, unknownToMessage } from "@ryot-app/contract/errors";
import { definitionOwner } from "@ryot-app/contract/modules/plugins/references";
import { UserId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { sandboxHostEffect } from "@ryot-app/sandbox/host/invocation";
import { sandboxContextError } from "@ryot-app/sandbox/protocol/limits";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { eq } from "drizzle-orm";
import { Cause, Context, DateTime, Effect, Layer, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine, WorkflowInstance } from "effect/workflow/WorkflowEngine";

import { DomainWriteChecks } from "#modules/entities/write-context";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow, dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { requireSandboxCapabilityInput } from "#modules/scripts/authorization/capabilities";
import { isDeclaredExecutableCall } from "#modules/scripts/authorization/executable-dependencies";
import { sandboxLifecycleCommand, sandboxRunUserId } from "#modules/scripts/host/execution-context";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { DatabaseSession } from "#platform/db/session";
import {
	asIndependentWorkflowRoot,
	implementWorkflow,
	makeActivity,
} from "#platform/workflow/scope";
import { scriptWork } from "#schema/tables/script-work";

import type { AdditionalScriptHostImplementationMap } from "../authorization/capabilities";
import { ScriptExecutionWorkflow } from "./workflow";
import { ScriptExecutionWorkflowPayload } from "./workflow-payload";

export const UserWorkWorkflow = Workflow.make("UserWorkWorkflow", {
	error: DbError,
	success: Schema.Void,
	idempotencyKey: ({ id }) => id,
	payload: Schema.Struct({ id: Schema.String, execution: ScriptExecutionWorkflowPayload }),
});

export class UserWorkRepository extends Context.Service<UserWorkRepository>()(
	"UserWorkRepository",
	{
		make: Effect.gen(function* () {
			const session = yield* DatabaseSession;
			const request = Effect.fn("UserWorkRepository.request")(function* (
				row: typeof scriptWork.$inferInsert,
			) {
				yield* session.run((db) => db.insert(scriptWork).values(row).onConflictDoNothing());
				const [stored] = yield* session.run((db) =>
					db
						.select({ status: scriptWork.status, inputHash: scriptWork.inputHash })
						.from(scriptWork)
						.where(eq(scriptWork.id, row.id)),
				);
				if (stored?.inputHash !== row.inputHash) {
					return yield* new DbError({ message: "Work key reused with different input" });
				}
				return stored.status;
			});
			const status = Effect.fn("UserWorkRepository.status")(function* (
				id: string,
				nextStatus: typeof scriptWork.$inferSelect.status,
				error: string | null = null,
			) {
				const updatedAt = yield* DateTime.nowAsDate;
				yield* session.run((db) =>
					db
						.update(scriptWork)
						.set({ error, updatedAt, status: nextStatus })
						.where(eq(scriptWork.id, id)),
				);
			});
			return { status, request };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const UserWorkWorkflowLive = implementWorkflow(UserWorkWorkflow, (payload) =>
	Effect.gen(function* () {
		const repository = yield* UserWorkRepository;
		const references = yield* SandboxWorkflowReferenceRepository;
		const engine = yield* WorkflowEngine;
		const receipts = yield* MutationReceipts.make;
		if (payload.execution.subject.type !== "user") {
			return yield* new DbError({ message: "User work requires a user account generation" });
		}
		yield* makeActivity({
			name: "start",
			error: DbError,
			success: Schema.Void,
			execute: repository.status(payload.id, "running"),
		});
		const result = yield* Effect.exit(
			dispatchAdmittedWorkflow(
				receipts,
				engine,
				ScriptExecutionWorkflow,
				payload.execution.subject.accountGeneration,
				{ payload: payload.execution, executionId: payload.execution.executionId },
				(effect) => effect,
				(effect) => effect,
			),
		);
		if (result._tag === "Failure") {
			const instance = yield* WorkflowInstance;
			if (instance.suspended && Cause.hasInterruptsOnly(result.cause)) {
				return yield* Effect.interrupt;
			}
		}
		yield* makeActivity({
			name: "finish",
			error: DbError,
			success: Schema.Void,
			execute: repository
				.status(
					payload.id,
					result._tag === "Success" ? "succeeded" : "failed",
					result._tag === "Failure" ? unknownToMessage(result.cause).slice(0, 8192) : null,
				)
				.pipe(Effect.andThen(references.release(payload.id))),
		});
		return undefined;
	}),
).pipe(
	Layer.provide(Layer.merge(UserWorkRepository.layer, SandboxWorkflowReferenceRepository.layer)),
);

export const makeUserWorkScriptHost = Effect.gen(function* () {
	const repository = yield* UserWorkRepository.make;
	const scripts = yield* SandboxRepository;
	const references = yield* SandboxWorkflowReferenceRepository.make;
	const session = yield* DatabaseSession;
	const writes = yield* DomainWriteChecks;
	const receipts = yield* MutationReceipts.make;
	const engine = yield* WorkflowEngine;
	const requestUserWork: AdditionalScriptHostImplementationMap["requestUserWork"] = (
		rawInput,
		request,
		reference,
	) =>
		sandboxHostEffect(
			Effect.gen(function* () {
				const input = yield* requireSandboxCapabilityInput(rawInput, "requestUserWork");
				const userId = sandboxRunUserId(input);
				const pin = input.principal.pluginRevision;
				const account = input.principal.subject.accountGeneration;
				if (userId === null || !pin || !account || account.userId !== userId) {
					return yield* Effect.fail("User work requires a pinned user execution");
				}
				const contextError = sandboxContextError(request.input);
				if (contextError) {
					return yield* Effect.fail(contextError);
				}
				const dependency = {
					index: 0,
					name: "user-work",
					kind: "activity" as const,
					args: { input: request.input, scriptSlug: reference.scriptSlug },
				};
				if (!isDeclaredExecutableCall(input.principal.metadata, dependency)) {
					return yield* Effect.fail("User work target is not a declared dependency");
				}
				const target = yield* scripts.resolveWorkflowCallScript(pin, dependency);
				const contentHash = pin.compiledHashes[reference.scriptSlug];
				if (target?.kind !== "script" || !contentHash) {
					return yield* Effect.fail("User work target is unavailable");
				}
				const id = `user-work-${sha256Hex(stableStringify([account, pin.id, target.scriptId, request.key]))}`;
				const execution = {
					pluginRevision: pin,
					input: request.input,
					scriptId: target.scriptId,
					executionId: `${id}-script`,
					lane: "background" as const,
					resolutionMode: "exact" as const,
					subject: {
						type: "user" as const,
						accountGeneration: account,
						userId: UserId.make(userId),
					},
				};
				const command = yield* sandboxLifecycleCommand(input, "api", "requestUserWork");
				yield* session.transaction(
					Effect.gen(function* () {
						yield* admitWorkflow(receipts, UserWorkWorkflow, account, id);
						yield* references.lockIngestionShared();
						yield* writes.check(command, definitionOwner(pin.id), UserId.make(userId), true);
						const status = yield* repository.request({
							id,
							userId,
							key: request.key,
							pluginId: pin.id,
							status: "queued",
							scope: request.scope,
							payload: yield* Schema.encodeUnknownEffect(JsonValue)(execution),
							inputHash: sha256Hex(stableStringify([request.scope, execution])),
						});
						if (status === "queued" || status === "running") {
							yield* references.registerInTransaction({
								userId,
								contentHash,
								executionId: id,
								pluginId: pin.id,
								expectedRevision: pin,
								scriptId: target.scriptId,
							});
						}
					}),
				);
				yield* engine
					.execute(UserWorkWorkflow, { discard: true, executionId: id, payload: { id, execution } })
					.pipe(asIndependentWorkflowRoot);
				return { workId: id };
			}),
		);
	return { requestUserWork };
});
