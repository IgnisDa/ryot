import { SandboxRunError, toSandboxRunError } from "@ryot-app/contract/errors";
import { providerTranslateResultSchema } from "@ryot-app/plugin-backend-sdk/provider";
import { DateTime, Effect, Result, Schema } from "effect";

import { EnrichmentRequests } from "#modules/entities/enrichment/requests";
import { publishEntityUpdated } from "#modules/live-updates/publish";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { type JobContext, registerJobHandler } from "#platform/jobs/worker";

import { TranslationsService } from "./service";
import { EntityTranslationJob, TranslationRequestPayload } from "./translation-request";

const decodeProviderTranslateResult = Schema.decodeUnknownEffect(providerTranslateResultSchema);

const translate = Effect.fn("translateEntity")(function* (
	payload: TranslationRequestPayload,
	requestId: string,
) {
	const translations = yield* TranslationsService;
	const sandbox = yield* ScriptExecutionService;
	const execution = yield* translations.admitExecution(payload);
	const pluginRevision = execution.principal.pluginRevision;
	if (!pluginRevision) {
		return yield* new SandboxRunError({
			kind: "missing-artifact",
			message: "Translation plugin pin is unavailable",
		});
	}
	const result = yield* sandbox
		.executeScript({
			pluginRevision,
			lane: payload.lane,
			subject: execution.principal.subject,
			scriptId: execution.principal.scriptId,
			executionId: `${requestId}-sandbox-translate`,
			input: {
				name: execution.name,
				language: payload.language,
				externalId: payload.externalId,
				properties: execution.properties,
				entitySchemaSlug: payload.entitySchemaSlug,
			},
		})
		.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));
	if (result.error) {
		return yield* new SandboxRunError({
			kind: result.error.kind,
			message: result.error.message,
			...(result.error.data === undefined ? {} : { data: result.error.data }),
		});
	}
	const translation = yield* decodeProviderTranslateResult(result.value).pipe(
		Effect.mapError(
			(error) =>
				new SandboxRunError({
					kind: "invalid-output",
					message: `Invalid translate result: ${error.message}`,
				}),
		),
	);
	yield* translations
		.upsert(
			{
				entityId: payload.entityId,
				language: payload.language,
				name: translation.name ?? null,
				populatedAt: yield* DateTime.nowAsDate,
				properties: translation.properties ?? null,
				sourceContentGeneration: execution.contentGeneration,
			},
			payload,
			execution,
		)
		.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));
	return yield* publishEntityUpdated(payload.entityId, "translated", [payload.userId]).pipe(
		Effect.catchCause((cause) => Effect.logWarning("translation publication failed", cause)),
	);
});

/** One attempt of a translation request. A retryable failure fails the job so it runs again. */
export const runEntityTranslationJob = Effect.fn("EntityTranslationJob")(function* (
	{ requestId }: typeof EntityTranslationJob.payload.Type,
	job: JobContext,
) {
	const requests = yield* EnrichmentRequests;
	const sandbox = yield* ScriptExecutionService;
	const row = yield* requests
		.get(requestId)
		.pipe(Effect.mapError((error) => toSandboxRunError(error, "infrastructure")));
	if (!row || row.state === "succeeded" || row.state === "failed" || row.state === "cancelled") {
		return yield* Effect.void;
	}
	const release = sandbox
		.releaseWorkflowRegistration(requestId)
		.pipe(Effect.catchCause((cause) => Effect.logWarning("Translation release failed", cause)));
	const payload = yield* Schema.decodeUnknownEffect(TranslationRequestPayload)(row.payload).pipe(
		Effect.mapError((error) => toSandboxRunError(error, "invalid-input")),
	);
	const attempt = job.attempt;
	yield* requests.update(requestId, { attempt, state: "running", failureKind: null });
	const result = yield* translate(payload, requestId).pipe(Effect.result);
	if (Result.isSuccess(result)) {
		yield* requests.update(requestId, { attempt, failureKind: null, state: "succeeded" });
		return yield* release;
	}
	const failure = result.failure;
	if (
		failure.data === undefined &&
		(failure.kind === "infrastructure" || failure.kind === "timeout") &&
		attempt < EntityTranslationJob.maxAttempts
	) {
		yield* requests.update(requestId, { attempt, state: "retrying", failureKind: failure.kind });
		return yield* failure;
	}
	yield* requests.update(requestId, { attempt, state: "failed", failureKind: failure.kind });
	return yield* release;
});

export const EntityTranslationJobLive = registerJobHandler(
	EntityTranslationJob,
	runEntityTranslationJob,
);
