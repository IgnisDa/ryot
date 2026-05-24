import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { match } from "ts-pattern";

import { db } from "~/lib/db";
import { user } from "~/lib/db/schema/auth";
import { userPreferencesSchema } from "~/modules/builtins";
import { importRunJobData } from "~/modules/imports/jobs";
import { processMediaImport } from "~/modules/imports/media/import-processor";
import { createImportRun, getImportRunById, updateImportRun } from "~/modules/imports/repository";
import type { ImportRunSource } from "~/modules/imports/schemas";

import { integrationRunJobData } from "./jobs";
import {
	fetchAudiobookshelfProgress,
	syncAudiobookshelfOwnedItems,
} from "./providers/yank/audiobookshelf";
import { fetchKomgaProgress, syncKomgaOwnedItems } from "./providers/yank/komga";
import { fetchPlexYankProgress, syncPlexYankOwnedItems } from "./providers/yank/plex-yank";
import { fetchYoutubeMusicProgress } from "./providers/yank/youtube-music";
import { getIntegrationByIdAnyUser, updateIntegrationRow } from "./repository";
import { checkAndAutoDisable } from "./service";

export { integrationRunJobName } from "./jobs";

const getUserDisableIntegrations = async (userId: string): Promise<boolean> => {
	const [row] = await db
		.select({ preferences: user.preferences })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	const parsed = userPreferencesSchema.safeParse(row?.preferences);
	return parsed.success ? parsed.data.disableIntegrations : false;
};

const processYankIntegration = async (
	job: Job,
	userId: string,
	integrationId: string,
	existingRunId: string | undefined,
): Promise<void> => {
	const integration = await getIntegrationByIdAnyUser({ id: integrationId });
	if (!integration) {
		throw new Error(`Integration ${integrationId} not found`);
	}

	if (await getUserDisableIntegrations(userId)) {
		return;
	}

	// oxlint-disable-next-line no-unsafe-type-assertion
	const source = integration.provider as ImportRunSource;
	const inputSummary = {
		lot: integration.lot,
		integrationId: integration.id,
		provider: integration.provider,
		...(integration.name ? { name: integration.name } : {}),
	};

	const pipelineState = importRunJobData.safeParse(job.data);

	let runId: string;
	if (existingRunId) {
		runId = existingRunId;
	} else {
		const run = await createImportRun({
			source,
			userId,
			inputSummary,
			integrationId: integration.id,
		});
		runId = run.id;
		await updateImportRun({ runId, status: "running", startedAt: new Date() });
	}

	const specs = integration.providerSpecifics;

	const getAdapterResult = async () => {
		const progressResult = await match(specs)
			.with({ kind: "audiobookshelf" }, (s) =>
				fetchAudiobookshelfProgress({ token: s.token, baseUrl: s.baseUrl }),
			)
			.with({ kind: "komga" }, (s) => fetchKomgaProgress({ apiKey: s.apiKey, baseUrl: s.baseUrl }))
			.with({ kind: "plex_yank" }, () => fetchPlexYankProgress())
			.with({ kind: "youtube_music" }, (s) =>
				fetchYoutubeMusicProgress({
					userId,
					integrationId,
					timezone: s.timezone,
					authCookie: s.authCookie,
				}),
			)
			.otherwise(() => {
				throw new Error(`Unknown yank provider: ${specs.kind}`);
			});

		if (!integration.syncOwnership) {
			return progressResult;
		}

		const ownedItems = await match(specs)
			.with({ kind: "audiobookshelf" }, (s) =>
				syncAudiobookshelfOwnedItems({ token: s.token, baseUrl: s.baseUrl }),
			)
			.with({ kind: "komga" }, (s) => syncKomgaOwnedItems({ apiKey: s.apiKey, baseUrl: s.baseUrl }))
			.with({ kind: "plex_yank" }, (s) =>
				syncPlexYankOwnedItems({ token: s.token, baseUrl: s.baseUrl }),
			)
			.otherwise(() => Promise.resolve([]));

		const ownedEntityGroups = ownedItems.map(({ entityRef, provider }, idx) => ({
			entityRef,
			events: [],
			collectionMemberships: [],
			ownershipProvider: provider,
			itemIndex: progressResult.entityGroups.length + idx,
		}));

		return {
			failures: progressResult.failures,
			entityGroups: [...progressResult.entityGroups, ...ownedEntityGroups],
		};
	};

	await processMediaImport(job, undefined, {
		runId,
		userId,
		sourceName: integration.provider,
		loadAdapterResult: getAdapterResult,
		adapterErrorFallback: `Failed to fetch data from ${integration.provider}`,
		writeContext: { origin: "integration", integrationId, importRunId: runId },
		importStep: pipelineState.success ? pipelineState.data.importStep : undefined,
		mediaEntityGroups: pipelineState.success ? pipelineState.data.mediaEntityGroups : undefined,
		providerEntityIds: pipelineState.success ? pipelineState.data.providerEntityIds : undefined,
		providerEntityRefs: pipelineState.success ? pipelineState.data.providerEntityRefs : undefined,
		resolveEntityIndex: pipelineState.success ? pipelineState.data.resolveEntityIndex : undefined,
		adapterFailureCount: pipelineState.success ? pipelineState.data.adapterFailureCount : undefined,
		resolveSandboxJobId: pipelineState.success ? pipelineState.data.resolveSandboxJobId : undefined,
		resolveCandidateIndex: pipelineState.success
			? pipelineState.data.resolveCandidateIndex
			: undefined,
		resolveFailedIndices: pipelineState.success
			? pipelineState.data.resolveFailedIndices
			: undefined,
		providerEntityIndex: pipelineState.success ? pipelineState.data.providerEntityIndex : undefined,
		providerSandboxJobId: pipelineState.success
			? pipelineState.data.providerSandboxJobId
			: undefined,
		providerFailedIndices: pipelineState.success
			? pipelineState.data.providerFailedIndices
			: undefined,
		mediaWriteGroupIndex: pipelineState.success
			? pipelineState.data.mediaWriteGroupIndex
			: undefined,
		mediaWriteFailedItems: pipelineState.success
			? pipelineState.data.mediaWriteFailedItems
			: undefined,
		mediaWriteImportedItems: pipelineState.success
			? pipelineState.data.mediaWriteImportedItems
			: undefined,
	});

	const completedRun = await getImportRunById({ runId, userId });
	if (completedRun?.status === "completed") {
		await updateIntegrationRow({ id: integrationId, userId, lastFinishedAt: new Date() });
	}

	await checkAndAutoDisable({ integrationId, userId });
};

export const processIntegrationQueueJob = async (job: Job): Promise<void> => {
	if (job.name !== "integration-run") {
		return;
	}
	const parsed = integrationRunJobData.safeParse(job.data);
	if (!parsed.success) {
		throw new Error("Integration run job payload is invalid");
	}
	const { userId, integrationId } = parsed.data;
	const existingRunId = parsed.data.runId?.trim() ?? undefined;

	const integration = await getIntegrationByIdAnyUser({ id: integrationId });
	if (!integration) {
		throw new Error(`Integration ${integrationId} not found`);
	}

	await match(integration.lot)
		.with("yank", () => processYankIntegration(job, userId, integrationId, existingRunId))
		.with("sink", () => {
			throw new Error(`Sink handler not yet implemented for provider: ${integration.provider}`);
		})
		.with("push", () => Promise.resolve())
		.exhaustive();
};
