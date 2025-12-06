import type { Job } from "bullmq";
import { eq } from "drizzle-orm";
import { match } from "ts-pattern";

import { db } from "~/lib/db";
import { user } from "~/lib/db/schema/auth";
import { userPreferencesSchema } from "~/modules/builtins";
import { importRunJobData } from "~/modules/imports/jobs";
import {
	processMediaImport,
	type MediaImportAdapterResult,
} from "~/modules/imports/media/import-processor";
import { createImportRun, getImportRunById, updateImportRun } from "~/modules/imports/repository";
import { failImportRun } from "~/modules/imports/runtime/failures";
import type { ImportRunSource, ListedImportRun } from "~/modules/imports/schemas";

import type { IntegrationRunJobData } from "./jobs";
import { integrationRunJobData } from "./jobs";
import { parseEmbySink } from "./providers/sink/emby";
import { parseGenericJsonSink } from "./providers/sink/generic-json";
import { parseJellyfinSink } from "./providers/sink/jellyfin-sink";
import { parseKodiSink } from "./providers/sink/kodi";
import { parsePlexSink } from "./providers/sink/plex-sink";
import { parseRyotBrowserExtensionSink } from "./providers/sink/ryot-browser-extension";
import type { SinkParserInput } from "./providers/sink/shared";
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

const toIntegrationJobData = (input: {
	runId?: string;
	userId: string;
	rawBody?: string;
	contentType?: string;
	integrationId: string;
}): IntegrationRunJobData => ({
	userId: input.userId,
	integrationId: input.integrationId,
	...(input.runId ? { runId: input.runId } : {}),
	...(input.rawBody !== undefined ? { rawBody: input.rawBody } : {}),
	...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
});

const createIntegrationImportJob = (job: Job, data: IntegrationRunJobData): Job =>
	// oxlint-disable-next-line no-unsafe-type-assertion
	new Proxy(job, {
		get(target, prop, receiver) {
			if (prop === "updateData") {
				return (nextData: Record<string, unknown>) => target.updateData({ ...data, ...nextData });
			}
			return Reflect.get(target, prop, receiver);
		},
	});

const parseSinkAdapterResult = async (
	input: SinkParserInput,
): Promise<MediaImportAdapterResult> => {
	const specs = input.integration.providerSpecifics;
	return match(specs)
		.with({ kind: "kodi" }, () => parseKodiSink(input))
		.with({ kind: "emby" }, () => parseEmbySink(input))
		.with({ kind: "plex_sink" }, () => parsePlexSink(input))
		.with({ kind: "generic_json" }, () => parseGenericJsonSink(input))
		.with({ kind: "jellyfin_sink" }, () => parseJellyfinSink(input))
		.with({ kind: "ryot_browser_extension" }, () => parseRyotBrowserExtensionSink(input))
		.otherwise(() => {
			throw new Error(`Unknown sink provider: ${specs.kind}`);
		});
};

type ProcessSinkIntegrationDeps = {
	failImportRun: typeof failImportRun;
	updateImportRun: typeof updateImportRun;
	processMediaImport: typeof processMediaImport;
	checkAndAutoDisable: typeof checkAndAutoDisable;
	updateIntegrationRow: typeof updateIntegrationRow;
	parseSinkAdapterResult: typeof parseSinkAdapterResult;
	getIntegrationByIdAnyUser: typeof getIntegrationByIdAnyUser;
	getImportRunById: (input: {
		runId: string;
		userId: string;
	}) => Promise<Pick<ListedImportRun, "status"> | undefined>;
};

const processSinkIntegrationDeps: ProcessSinkIntegrationDeps = {
	failImportRun,
	updateImportRun,
	getImportRunById,
	processMediaImport,
	checkAndAutoDisable,
	updateIntegrationRow,
	parseSinkAdapterResult,
	getIntegrationByIdAnyUser,
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

	const importJob = createIntegrationImportJob(
		job,
		toIntegrationJobData({ integrationId, runId, userId }),
	);

	await processMediaImport(importJob, undefined, {
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

export const createProcessSinkIntegration =
	(deps: ProcessSinkIntegrationDeps = processSinkIntegrationDeps) =>
	async (
		job: Job,
		userId: string,
		integrationId: string,
		existingRunId: string | undefined,
		rawBody: string | undefined,
		contentType: string | undefined,
	): Promise<void> => {
		if (!existingRunId) {
			throw new Error("Sink integration job payload is missing runId");
		}

		const integration = await deps.getIntegrationByIdAnyUser({ id: integrationId });
		if (!integration) {
			throw new Error(`Integration ${integrationId} not found`);
		}

		const pipelineState = importRunJobData.safeParse(job.data);
		const hasNormalizedState =
			pipelineState.success && pipelineState.data.mediaEntityGroups !== undefined;
		if (!hasNormalizedState) {
			await deps.updateImportRun({
				status: "running",
				runId: existingRunId,
				startedAt: new Date(),
			});
		}

		const importJob = createIntegrationImportJob(
			job,
			toIntegrationJobData({
				userId,
				rawBody,
				contentType,
				integrationId,
				runId: existingRunId,
			}),
		);

		let adapterResult: MediaImportAdapterResult | undefined;
		await deps.processMediaImport(importJob, undefined, {
			userId,
			runId: existingRunId,
			sourceName: integration.provider,
			importStep: pipelineState.success ? pipelineState.data.importStep : undefined,
			adapterErrorFallback: `Failed to parse ${integration.provider} webhook payload`,
			writeContext: { origin: "integration", integrationId, importRunId: existingRunId },
			mediaEntityGroups: pipelineState.success ? pipelineState.data.mediaEntityGroups : undefined,
			providerEntityIds: pipelineState.success ? pipelineState.data.providerEntityIds : undefined,
			providerEntityRefs: pipelineState.success ? pipelineState.data.providerEntityRefs : undefined,
			resolveEntityIndex: pipelineState.success ? pipelineState.data.resolveEntityIndex : undefined,
			adapterFailureCount: pipelineState.success
				? pipelineState.data.adapterFailureCount
				: undefined,
			resolveSandboxJobId: pipelineState.success
				? pipelineState.data.resolveSandboxJobId
				: undefined,
			resolveCandidateIndex: pipelineState.success
				? pipelineState.data.resolveCandidateIndex
				: undefined,
			resolveFailedIndices: pipelineState.success
				? pipelineState.data.resolveFailedIndices
				: undefined,
			providerEntityIndex: pipelineState.success
				? pipelineState.data.providerEntityIndex
				: undefined,
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
			loadAdapterResult: async () => {
				if (rawBody === undefined) {
					throw new Error(`Integration job is missing raw body for ${integration.provider}`);
				}
				adapterResult = await deps.parseSinkAdapterResult({
					rawBody,
					integration,
					contentType: contentType ?? "application/json",
				});
				return adapterResult;
			},
		});

		const hadOnlyAdapterFailures = hasNormalizedState
			? (pipelineState.data.adapterFailureCount ?? 0) > 0 &&
				(pipelineState.data.mediaEntityGroups?.length ?? 0) === 0
			: (adapterResult?.failures.length ?? 0) > 0 &&
				(adapterResult?.entityGroups.length ?? 0) === 0;

		if (hadOnlyAdapterFailures) {
			await deps.failImportRun(
				existingRunId,
				adapterResult?.failures[0]?.message ??
					`Failed to process ${integration.provider} webhook payload`,
				deps.updateImportRun,
			);
		}

		const completedRun = await deps.getImportRunById({ runId: existingRunId, userId });
		if (completedRun?.status === "completed") {
			await deps.updateIntegrationRow({ id: integrationId, userId, lastFinishedAt: new Date() });
		}

		await deps.checkAndAutoDisable({ integrationId, userId });
	};

const processSinkIntegration = createProcessSinkIntegration();

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
		.with("sink", () =>
			processSinkIntegration(
				job,
				userId,
				integrationId,
				existingRunId,
				parsed.data.rawBody,
				parsed.data.contentType,
			),
		)
		.with("push", () => Promise.resolve())
		.exhaustive();
};
