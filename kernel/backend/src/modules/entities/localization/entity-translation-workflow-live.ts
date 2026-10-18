import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import { encodeEntityUpdatedMessage } from "@ryot-app/contract/modules/entity-watches/messages";
import { AutomationExecutionId } from "@ryot-app/contract/schema/brands";
import {
	type ProviderTranslateResult,
	providerTranslateResultSchema,
} from "@ryot-app/plugin-backend-sdk/provider";
import { DateTime, Effect, Result, Schema } from "effect";
import { DurableClock } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import type { DurableSchema } from "#boot/workflow-engine";
import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow, dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import { redisKeys, RedisService } from "#platform/redis";
import { implementWorkflow, makeActivity } from "#platform/workflow/scope";

import {
	TranslateEntityAttemptWorkflow,
	type TranslateEntityAttemptWorkflowPayload,
	TranslateEntityWorkflow,
	type TranslateEntityWorkflowPayload,
	type TranslationExecution,
} from "./entity-translation-workflow";
import { TranslateEntityWorkflowOperations } from "./operations-workflow";
import { TranslationsService } from "./service";

const decodeProviderTranslateResult = Schema.decodeUnknownEffect(providerTranslateResultSchema);

const writeTranslationOverlay = Effect.fn("writeTranslationOverlay")(function* (
	payload: TranslateEntityWorkflowPayload,
	execution: TranslationExecution,
	translation: ProviderTranslateResult,
) {
	const redis = yield* RedisService;
	const translations = yield* TranslationsService;

	return yield* makeActivity({
		name: "write-translation-overlay",
		success: Schema.Void satisfies DurableSchema,
		error: SandboxRunError satisfies DurableSchema,
		execute: Effect.gen(function* () {
			const populatedAt = yield* DateTime.nowAsDate;
			yield* translations
				.upsert(
					{
						populatedAt,
						entityId: payload.entityId,
						language: payload.language,
						name: translation.name ?? null,
						properties: translation.properties ?? null,
						sourceContentGeneration: execution.contentGeneration,
					},
					payload,
					execution,
				)
				.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));
			yield* redis.publish(
				redisKeys.entityUpdatedChannel,
				encodeEntityUpdatedMessage(payload.entityId, "translated"),
			);
		}),
	});
});

export const runTranslateEntityAttemptWorkflow = Effect.fn("TranslateEntityAttemptWorkflow")(
	function* (payload: TranslateEntityAttemptWorkflowPayload, executionId: string) {
		yield* Effect.annotateCurrentSpan({
			executionId,
			entityId: payload.entityId,
			externalId: payload.externalId,
			providerId: payload.providerId,
		});
		const operations = yield* TranslateEntityWorkflowOperations;
		const { execution, result: sandboxResult } = yield* operations
			.processSandbox(payload, executionId, payload.execution)
			.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));

		if (sandboxResult.error) {
			return yield* new SandboxRunError({
				kind: sandboxResult.error.kind,
				message: sandboxResult.error.message,
				...(sandboxResult.error.data === undefined ? {} : { data: sandboxResult.error.data }),
			});
		}

		const translation = yield* decodeProviderTranslateResult(sandboxResult.value).pipe(
			Effect.mapError(
				(error) =>
					new SandboxRunError({
						kind: "invalid-output",
						message: `Invalid translate result: ${error.message}`,
					}),
			),
		);
		yield* writeTranslationOverlay(payload, execution, translation);
		return yield* Effect.void;
	},
	(effect, _payload, executionId) =>
		Effect.annotateLogs(effect, { executionId, workflow: "TranslateEntityWorkflow" }),
);

export const TranslateEntityAttemptWorkflowDefinitionsLive = implementWorkflow(
	TranslateEntityAttemptWorkflow,
	runTranslateEntityAttemptWorkflow,
);

export const runTranslateEntityWorkflow = Effect.fn("TranslateEntityWorkflow")(function* (
	payload: TranslateEntityWorkflowPayload,
	executionId: string,
) {
	const requests = yield* EnrichmentRequests;
	const receipts = yield* MutationReceipts.make;
	const engine = yield* WorkflowEngine;
	const operations = yield* TranslateEntityWorkflowOperations;
	yield* admitWorkflow(
		receipts,
		TranslateEntityWorkflow,
		payload.accountGeneration,
		executionId,
	).pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));
	const release = makeActivity({
		name: "release-translation-registration",
		success: Schema.Void satisfies DurableSchema,
		error: SandboxRunError satisfies DurableSchema,
		execute: operations.releaseRegistration(executionId),
	});
	const run = Effect.gen(function* () {
		if (payload.entitySchemaPluginId === null) {
			return yield* new SandboxRunError({
				kind: "invalid-input",
				message: "Translation entity is not owned by a plugin",
			});
		}
		yield* makeActivity({
			name: "ensure-translation-request",
			error: SandboxRunError satisfies DurableSchema,
			execute: requests
				.ensure({
					payload,
					level: null,
					id: executionId,
					operation: "translation",
					entityId: payload.entityId,
					language: payload.language,
					providerId: payload.providerId,
					externalId: payload.externalId,
					requester: payload.accountGeneration,
					pluginId: payload.entitySchemaPluginId,
					scopeUserId: payload.entityScopeUserId,
					workflowName: TranslateEntityWorkflow._tag,
					entitySchemaSlug: payload.entitySchemaSlug,
					sourceContentGeneration: payload.contentGeneration,
				})
				.pipe(Effect.asVoid),
		});
		let execution: TranslationExecution | undefined;
		for (let attempt = 1; attempt <= 3; attempt += 1) {
			yield* makeActivity({
				name: `translation-running:${attempt}`,
				error: SandboxRunError satisfies DurableSchema,
				execute: requests.update(executionId, {
					attempt,
					state: "running",
					failureKind: null,
					nextAttemptAt: null,
				}),
			});
			const attemptId = `${executionId}-attempt-${attempt}`;
			const result = yield* Effect.gen(function* () {
				execution ??= yield* operations.captureExecution(payload, executionId, attempt);
				return yield* dispatchAdmittedWorkflow(
					receipts,
					engine,
					TranslateEntityAttemptWorkflow,
					payload.accountGeneration,
					{
						executionId: attemptId,
						payload: {
							...payload,
							execution,
							executionId: attemptId,
							requestId: executionId,
							command: {
								...payload.command,
								causation: {
									...payload.command.causation,
									executionId: AutomationExecutionId.make(attemptId),
								},
							},
						},
					},
					(admission) =>
						admission.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure"))),
					(dispatch) => dispatch,
				);
			}).pipe(Effect.result);
			if (Result.isSuccess(result)) {
				yield* makeActivity({
					name: "translation-succeeded",
					error: SandboxRunError satisfies DurableSchema,
					execute: requests.update(executionId, {
						attempt,
						failureKind: null,
						state: "succeeded",
						nextAttemptAt: null,
					}),
				});
				return yield* Effect.void;
			}
			const failure = result.failure;
			if (
				attempt === 3 ||
				failure.data !== undefined ||
				(failure.kind !== "infrastructure" && failure.kind !== "timeout")
			) {
				return yield* failure;
			}
			const delayMs = attempt === 1 ? 5_000 : 30_000;
			yield* makeActivity({
				name: `translation-retrying:${attempt}`,
				error: SandboxRunError satisfies DurableSchema,
				execute: Effect.gen(function* () {
					const now = yield* DateTime.now;
					yield* requests.update(executionId, {
						attempt,
						state: "retrying",
						failureKind: failure.kind,
						nextAttemptAt: DateTime.toDateUtc(DateTime.add(now, { milliseconds: delayMs })),
					});
				}),
			});
			yield* DurableClock.sleep({
				duration: delayMs,
				inMemoryThreshold: 0,
				name: `translation-retry:${attempt}`,
			});
		}
		return yield* Effect.die("Translation exhausted its bounded attempts");
	});
	const result = yield* run.pipe(Effect.result);
	if (Result.isFailure(result)) {
		yield* makeActivity({
			name: "translation-failed",
			error: SandboxRunError satisfies DurableSchema,
			execute: requests.update(executionId, {
				state: "failed",
				nextAttemptAt: null,
				failureKind: result.failure.kind,
			}),
		});
		yield* release;
		return yield* result.failure;
	}
	return yield* release;
});

export const TranslateEntityWorkflowDefinitionsLive = implementWorkflow(
	TranslateEntityWorkflow,
	runTranslateEntityWorkflow,
);
