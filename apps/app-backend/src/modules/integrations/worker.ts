import { DurableQueue } from "@effect/workflow";
import { DateTime, Effect, Schema } from "effect";

import { DbRunner } from "~/lib/db";
import {
	processMediaImport,
	type MediaImportAdapterResult,
	type MediaImportAdapterResultSchema,
} from "~/modules/imports/media/import-processor";
import type { ImportEntityRef } from "~/modules/imports/media/types";
import { ImportsRepository } from "~/modules/imports/repository";
import {
	failImportRun,
	recordImportRunFailure,
	sanitizeErrorMessage,
} from "~/modules/imports/runtime/failures";
import {
	adaptAudiobookshelfData,
	syncAudiobookshelfOwnedItems,
} from "~/modules/imports/sources/audiobookshelf/adapter";
import { adaptPlexData, syncPlexYankOwnedItems } from "~/modules/imports/sources/plex/adapter";

import { IntegrationRunError, IntegrationRunJobData } from "./jobs";
import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { adaptKomgaData, syncKomgaOwnedItems } from "./yank/komga";
import { adaptYoutubeMusicData } from "./yank/youtube-music";

type OwnedItem = { entityRef: ImportEntityRef; provider: string };

export const appendOwnedItems = (
	progress: MediaImportAdapterResult,
	ownedItems: ReadonlyArray<OwnedItem>,
): MediaImportAdapterResult => ({
	failures: progress.failures,
	entityGroups: [
		...progress.entityGroups,
		...ownedItems.map(({ entityRef, provider }, idx) => ({
			entityRef,
			events: [],
			collectionMemberships: [],
			ownershipProvider: provider,
			itemIndex: progress.entityGroups.length + idx,
		})),
	],
});

const withOwnership = <EA, RA, EO, RO>(
	syncOwnership: boolean,
	progress: Effect.Effect<MediaImportAdapterResult, EA, RA>,
	ownedItems: Effect.Effect<ReadonlyArray<OwnedItem>, EO, RO>,
): Effect.Effect<MediaImportAdapterResult, EA | EO, RA | RO> =>
	syncOwnership
		? Effect.gen(function* () {
				const progressResult = yield* progress;
				const owned = yield* ownedItems;
				return appendOwnedItems(progressResult, owned);
			})
		: progress;

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

export const failAdapterOnlyRun = (
	runId: string,
	result: typeof MediaImportAdapterResultSchema.Type,
) =>
	Effect.gen(function* () {
		for (const failure of result.failures) {
			yield* recordImportRunFailure({
				runId,
				message: failure.message,
				itemIndex: failure.itemIndex,
				sourceLabel: failure.sourceLabel,
				sourceIdentifier: failure.sourceIdentifier,
				stage: failure.stage ?? "input_transformation",
				context: failure.context ? { ...failure.context } : null,
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

const runYankIntegration = (integration: IntegrationRecord, runId: string) =>
	Effect.gen(function* () {
		const specs = integration.providerSpecifics;
		const eventContext = { origin: "integration" as const, integrationId: integration.id };

		if (specs.kind === "audiobookshelf") {
			const credentials = { apiKey: specs.token, apiUrl: specs.baseUrl };
			yield* processMediaImport({
				runId,
				eventContext,
				userId: integration.userId,
				sourceName: "Audiobookshelf",
				adapterErrorFallback: "Failed to fetch data from Audiobookshelf",
				loadAdapterResult: withOwnership(
					integration.syncOwnership,
					adaptAudiobookshelfData(credentials),
					syncAudiobookshelfOwnedItems(credentials),
				),
			});
			return;
		}
		if (specs.kind === "plex_yank") {
			const credentials = { apiKey: specs.token, apiUrl: specs.baseUrl };
			yield* processMediaImport({
				runId,
				eventContext,
				sourceName: "Plex",
				userId: integration.userId,
				adapterErrorFallback: "Failed to fetch data from Plex",
				loadAdapterResult: withOwnership(
					integration.syncOwnership,
					adaptPlexData(credentials),
					syncPlexYankOwnedItems(credentials),
				),
			});
			return;
		}
		if (specs.kind === "komga") {
			const credentials = { apiKey: specs.apiKey, baseUrl: specs.baseUrl };
			yield* processMediaImport({
				runId,
				eventContext,
				sourceName: "Komga",
				userId: integration.userId,
				adapterErrorFallback: "Failed to fetch data from Komga",
				loadAdapterResult: withOwnership(
					integration.syncOwnership,
					adaptKomgaData(credentials),
					syncKomgaOwnedItems(credentials),
				),
			});
			return;
		}
		if (specs.kind === "youtube_music") {
			yield* processMediaImport({
				runId,
				eventContext,
				userId: integration.userId,
				sourceName: "YouTube Music",
				adapterErrorFallback: "Failed to fetch data from YouTube Music",
				loadAdapterResult: adaptYoutubeMusicData({
					runId,
					userId: integration.userId,
					timezone: specs.timezone,
					authCookie: specs.authCookie,
					integrationId: integration.id,
				}),
			});
			return;
		}

		yield* failUnsupportedIntegrationRun(runId, integration.provider);
	});

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

		yield* runYankIntegration(integration, payload.runId).pipe(
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
