import { DurableQueue } from "@effect/workflow";
import type { ImportRunId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import { DateTime, Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import type { MediaImportAdapterResult } from "#modules/imports/media/adapter-result";
import type { ImportEntityRef } from "#modules/imports/media/types";
import { ImportsRepository } from "#modules/imports/repository";
import { sanitizeErrorMessage } from "#modules/imports/runtime/import-run-status";
import {
	adaptAudiobookshelfData,
	syncAudiobookshelfOwnedItems,
} from "#modules/imports/sources/audiobookshelf/adapter";
import { adaptPlexData, syncPlexYankOwnedItems } from "#modules/imports/sources/plex/adapter";
import { SandboxExecutionQueue } from "#modules/sandbox/durable-queues";

import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { adaptKomgaData, syncKomgaOwnedItems } from "./yank/komga";

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

const resolveYankAdapter = (integration: IntegrationRecord) => {
	const specs = integration.providerSpecifics;
	if (specs.kind === "audiobookshelf") {
		const credentials = { apiKey: specs.token, apiUrl: specs.baseUrl };
		return {
			fallback: "Failed to fetch data from Audiobookshelf",
			load: withOwnership(
				integration.syncOwnership,
				adaptAudiobookshelfData(credentials),
				syncAudiobookshelfOwnedItems(credentials),
			),
		};
	}
	if (specs.kind === "plex_yank") {
		const credentials = { apiKey: specs.token, apiUrl: specs.baseUrl };
		return {
			fallback: "Failed to fetch data from Plex",
			load: withOwnership(
				integration.syncOwnership,
				adaptPlexData(credentials),
				syncPlexYankOwnedItems(credentials),
			),
		};
	}
	if (specs.kind === "komga") {
		const credentials = { apiKey: specs.apiKey, baseUrl: specs.baseUrl };
		return {
			fallback: "Failed to fetch data from Komga",
			load: withOwnership(
				integration.syncOwnership,
				adaptKomgaData(credentials),
				syncKomgaOwnedItems(credentials),
			),
		};
	}
	return null;
};

export const loadYankAdapterResult = (integration: IntegrationRecord) => {
	const adapter = resolveYankAdapter(integration);
	if (!adapter) {
		return Effect.fail({
			cleanupPaths: [] as ReadonlyArray<string>,
			message: `${integration.provider} integration is not implemented in V2 yet`,
		});
	}

	return adapter.load.pipe(
		Effect.map((adapterResult) => ({
			adapterResult,
			cleanupPaths: [] as ReadonlyArray<string>,
		})),
		Effect.mapError((error) => ({
			cleanupPaths: [] as ReadonlyArray<string>,
			message: sanitizeErrorMessage(error, adapter.fallback),
		})),
	);
};

export const runYoutubeMusicHistorySandbox = (input: {
	userId: UserId;
	scriptId: SandboxScriptId;
	executionId: string;
	context: { authCookie: string; timezone: string };
}) =>
	DurableQueue.process(SandboxExecutionQueue, {
		driverName: "history",
		userId: input.userId,
		context: input.context,
		scriptId: input.scriptId,
		executionId: input.executionId,
	});

export const finalizeIntegrationRun = Effect.fn("integrationsWorker.finalizeIntegrationRun")(
	function* (integration: IntegrationRecord, runId: ImportRunId) {
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
			return false;
		}

		const lastRuns = yield* runWithDb(
			repository.listRecentStatusesByIntegrationId({ integrationId: integration.id, limit: 5 }),
		);
		if (lastRuns.length < 5 || lastRuns.some((candidate) => candidate.status !== "failed")) {
			return false;
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
		return true;
	},
);
