import { DurableQueue, Workflow } from "@effect/workflow";
import { DateTime, Effect, Layer, Schema } from "effect";

import { DbRunner } from "~/lib/db";
import {
	processMediaImport,
	type MediaImportAdapterResult,
} from "~/modules/imports/media/import-processor";
import { ImportsRepository } from "~/modules/imports/repository";
import {
	failImportRun,
	recordImportRunFailure,
	sanitizeErrorMessage,
} from "~/modules/imports/runtime/failures";
import { adaptAudiobookshelfData } from "~/modules/imports/sources/audiobookshelf/adapter";
import { adaptPlexData } from "~/modules/imports/sources/plex/adapter";
import { buildMovieOrShowImportRef } from "~/modules/imports/sources/shared/provider-refs";

import { IntegrationsRepository, type IntegrationRecord } from "./repository";

type AudiobookshelfIntegration = IntegrationRecord & {
	readonly providerSpecifics: Extract<
		IntegrationRecord["providerSpecifics"],
		{ kind: "audiobookshelf" }
	>;
};

const IntegrationRunJobData = Schema.Struct({
	runId: Schema.String,
	userId: Schema.String,
	integrationId: Schema.String,
	payload: Schema.optional(Schema.Unknown),
});

type IntegrationRunJobData = typeof IntegrationRunJobData.Type;

class IntegrationRunError extends Schema.TaggedError<IntegrationRunError>()("IntegrationRunError", {
	message: Schema.String,
}) {}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const unsupportedSinkResult = (provider: string): MediaImportAdapterResult => ({
	entityGroups: [],
	failures: [
		{
			itemIndex: 0,
			stage: "source_fetch",
			message: `${provider} integration is not implemented in V2 yet`,
		},
	],
});

const invalidKodiPayloadResult = (): MediaImportAdapterResult => ({
	entityGroups: [],
	failures: [
		{
			itemIndex: 0,
			stage: "input_transformation",
			message: "Could not parse Kodi webhook payload",
		},
	],
});

export const parseKodiSinkPayload = (payload: unknown): MediaImportAdapterResult => {
	if (!isObjectRecord(payload)) {
		return invalidKodiPayloadResult();
	}

	const lot = payload.lot;
	const progress = payload.progress;
	const identifier = payload.identifier;
	const rawSeason = payload.show_season_number;
	const rawEpisode = payload.show_episode_number;

	if (typeof progress !== "number" || !Number.isFinite(progress)) {
		return invalidKodiPayloadResult();
	}

	if (lot !== "movie" && lot !== "show") {
		return invalidKodiPayloadResult();
	}

	const normalizedIdentifier =
		typeof identifier === "string"
			? identifier.trim()
			: typeof identifier === "number" && Number.isFinite(identifier)
				? String(identifier)
				: "";
	const ref = buildMovieOrShowImportRef({
		entitySchemaSlug: lot,
		sourceLabel: normalizedIdentifier,
		providerIds: { tmdb: normalizedIdentifier },
	});
	if (!ref) {
		return {
			entityGroups: [],
			failures: [
				{
					itemIndex: 0,
					stage: "input_transformation",
					message: "Kodi webhook payload is missing a TMDB identifier",
				},
			],
		};
	}

	return {
		failures: [],
		entityGroups: [
			{
				entityRef: ref,
				itemIndex: 0,
				collectionMemberships: [],
				events: [
					{
						eventSchemaSlug: "progress",
						occurredAt: new Date().toISOString(),
						properties: {
							consumedOn: "kodi",
							progressPercent: progress,
							...(lot === "show" && Number.isInteger(rawSeason) ? { showSeason: rawSeason } : {}),
							...(lot === "show" && Number.isInteger(rawEpisode)
								? { showEpisode: rawEpisode }
								: {}),
						},
					},
				],
			},
		],
	};
};

export const getSinkAdapterResult = (
	integration: IntegrationRecord,
	payload: unknown,
): MediaImportAdapterResult => {
	const kind = integration.providerSpecifics.kind;
	if (kind === "kodi") {
		return parseKodiSinkPayload(payload);
	}
	return unsupportedSinkResult(integration.provider);
};

const markFailedRunCounts = (runId: string, failureCount: number) =>
	Effect.gen(function* () {
		const repository = yield* ImportsRepository;
		const runWithDb = yield* DbRunner;
		yield* runWithDb(
			repository.updateRun({
				runId,
				progress: 100,
				totalItems: failureCount,
				failedItems: failureCount,
				processedItems: failureCount,
			}),
		);
	});

export const failAdapterOnlyRun = (runId: string, result: MediaImportAdapterResult) =>
	Effect.gen(function* () {
		for (const failure of result.failures) {
			yield* recordImportRunFailure({
				runId,
				message: failure.message,
				itemIndex: failure.itemIndex,
				context: failure.context ?? null,
				sourceLabel: failure.sourceLabel,
				sourceIdentifier: failure.sourceIdentifier,
				stage: failure.stage ?? "input_transformation",
			});
		}

		yield* markFailedRunCounts(runId, result.failures.length);
		yield* failImportRun(runId, result.failures[0]?.message ?? "Integration job failed");
	});

export const failUnsupportedIntegrationRun = (runId: string, provider: string) =>
	Effect.gen(function* () {
		yield* recordImportRunFailure({
			runId,
			itemIndex: 0,
			stage: "source_fetch",
			message: `${provider} integration is not implemented in V2 yet`,
		});
		yield* markFailedRunCounts(runId, 1);
		yield* failImportRun(runId, `${provider} integration is not implemented in V2 yet`);
	});

const markRunStarted = (runId: string) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* ImportsRepository;
		const startedAt = yield* DateTime.nowAsDate;
		yield* runWithDb(repository.updateRun({ runId, status: "running", startedAt }));
	});

export const finalizeIntegrationRun = (integration: IntegrationRecord, runId: string) =>
	Effect.gen(function* () {
		const repository = yield* ImportsRepository;
		const integrationsRepository = yield* IntegrationsRepository;
		const runWithDb = yield* DbRunner;

		const run = yield* runWithDb(repository.getRunById({ runId, userId: integration.userId }));
		if (run?.status === "completed") {
			const finishedAt = yield* DateTime.nowAsDate;
			yield* runWithDb(
				integrationsRepository
					.updateForUser({
						userId: integration.userId,
						lastFinishedAt: finishedAt,
						integrationId: integration.id,
					})
					.pipe(Effect.asVoid),
			);
		}

		if (!integration.extraSettings.disableOnContinuousErrors) {
			return;
		}

		const lastRuns = yield* runWithDb(
			repository.listRecentStatusesByIntegrationId({ integrationId: integration.id, limit: 5 }),
		);
		if (lastRuns.length < 5 || lastRuns.some((candidate) => candidate.status !== "failed")) {
			return;
		}

		yield* runWithDb(
			integrationsRepository
				.updateForUser({
					isDisabled: true,
					userId: integration.userId,
					integrationId: integration.id,
				})
				.pipe(Effect.asVoid),
		);
	});

const runAudiobookshelfIntegration = (input: {
	integration: IntegrationRecord;
	runId: string;
	providerSpecifics: AudiobookshelfIntegration["providerSpecifics"];
}) =>
	processMediaImport({
		runId: input.runId,
		sourceName: "Audiobookshelf",
		userId: input.integration.userId,
		adapterErrorFallback: "Failed to fetch data from Audiobookshelf",
		eventContext: { origin: "integration", integrationId: input.integration.id },
		loadAdapterResult: adaptAudiobookshelfData({
			apiKey: input.providerSpecifics.token,
			apiUrl: input.providerSpecifics.baseUrl,
		}),
	});

const runSinkIntegration = (integration: IntegrationRecord, runId: string, payload: unknown) =>
	Effect.gen(function* () {
		const adapterResult = getSinkAdapterResult(integration, payload);
		if (adapterResult.entityGroups.length === 0 && adapterResult.failures.length > 0) {
			yield* failAdapterOnlyRun(runId, adapterResult);
			return;
		}

		yield* processMediaImport({
			runId,
			userId: integration.userId,
			sourceName: integration.provider,
			loadAdapterResult: Effect.succeed(adapterResult),
			eventContext: { origin: "integration", integrationId: integration.id },
			adapterErrorFallback: `Failed to parse ${integration.provider} webhook payload`,
		});
	});

const runYankIntegration = (integration: IntegrationRecord, runId: string) => {
	const providerSpecifics = integration.providerSpecifics;
	if (providerSpecifics.kind === "audiobookshelf") {
		return runAudiobookshelfIntegration({ integration, runId, providerSpecifics });
	}
	if (providerSpecifics.kind === "plex_yank") {
		return processMediaImport({
			runId,
			sourceName: "Plex",
			userId: integration.userId,
			adapterErrorFallback: "Failed to fetch data from Plex",
			eventContext: { origin: "integration", integrationId: integration.id },
			loadAdapterResult: adaptPlexData({
				apiKey: providerSpecifics.token,
				apiUrl: providerSpecifics.baseUrl,
			}),
		});
	}

	return failUnsupportedIntegrationRun(runId, integration.provider);
};

export const IntegrationRunQueue = DurableQueue.make({
	success: Schema.Void,
	error: IntegrationRunError,
	payload: IntegrationRunJobData,
	idempotencyKey: ({ runId }) => runId,
	name: "IntegrationRunProcessingQueue",
});

const processIntegrationRunJob = (payload: IntegrationRunJobData) =>
	Effect.gen(function* () {
		const runWithDb = yield* DbRunner;
		const repository = yield* IntegrationsRepository;

		const integration = yield* runWithDb(
			repository.getByIdAnyUser({ integrationId: payload.integrationId }),
		);
		if (!integration) {
			yield* failImportRun(payload.runId, "Integration not found");
			return;
		}

		if (integration.isDisabled) {
			yield* failImportRun(payload.runId, "Integration is disabled");
			return;
		}

		const disableIntegrations = yield* runWithDb(
			repository.getUserDisableIntegrations({ userId: integration.userId }),
		);
		if (disableIntegrations) {
			yield* failImportRun(payload.runId, "Integrations are disabled for this user");
			return;
		}

		yield* markRunStarted(payload.runId);

		const runEffect =
			integration.lot === "sink"
				? runSinkIntegration(integration, payload.runId, payload.payload)
				: runYankIntegration(integration, payload.runId);

		yield* runEffect.pipe(
			Effect.catchAll((error) =>
				failImportRun(
					payload.runId,
					sanitizeErrorMessage(error, "Integration job failed unexpectedly"),
				),
			),
		);
		yield* finalizeIntegrationRun(integration, payload.runId);
	});

export const IntegrationRunQueueWorkerLive = DurableQueue.worker(
	IntegrationRunQueue,
	(payload) => processIntegrationRunJob(payload).pipe(Effect.orDie),
	{ concurrency: 1 },
);

export const ProcessIntegrationRunWorkflow = Workflow.make({
	success: Schema.Void,
	error: IntegrationRunError,
	payload: IntegrationRunJobData,
	idempotencyKey: ({ runId }) => runId,
	name: "ProcessIntegrationRunWorkflow",
});

const ProcessIntegrationRunWorkflowLive = ProcessIntegrationRunWorkflow.toLayer((payload) =>
	DurableQueue.process(IntegrationRunQueue, payload),
);

export const IntegrationWorkflowDefinitionsLive = Layer.mergeAll(
	IntegrationRunQueueWorkerLive,
	ProcessIntegrationRunWorkflowLive,
);
