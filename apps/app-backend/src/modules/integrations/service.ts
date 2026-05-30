import { eq } from "drizzle-orm";

import { config } from "~/lib/config";
import { db } from "~/lib/db";
import { user } from "~/lib/db/schema/auth";
import { getQueues } from "~/lib/queue";
import { type ServiceResult, serviceData, serviceError } from "~/lib/result";
import { userPreferencesSchema } from "~/modules/builtins";
import { createImportRun } from "~/modules/imports/repository";
import { failImportRun, recordImportRunFailure } from "~/modules/imports/runtime/failures";

import { integrationRunJobName } from "./jobs";
import {
	createIntegrationRow,
	deleteIntegrationRow,
	getIntegrationByIdAnyUser,
	getIntegrationById,
	getLastNRunsForIntegration,
	listIntegrationRunsByIntegrationId,
	listIntegrationsByUser,
	updateIntegrationRow,
} from "./repository";
import { addYankRepeatJob, removeYankRepeatJob } from "./scheduler";
import type {
	CreateIntegrationBody,
	IntegrationProvider,
	ListedIntegration,
	PatchIntegrationBody,
} from "./schemas";
import { integrationProviderSpecifics as providerSpecificsSchema, isSinkProvider } from "./schemas";

type IntegrationServiceError = "not_found" | "validation";
type IntegrationServiceResult<T> = ServiceResult<T, IntegrationServiceError>;

const providerLotMap: Record<IntegrationProvider, "yank" | "sink" | "push"> = {
	kodi: "sink",
	emby: "sink",
	komga: "yank",
	radarr: "push",
	sonarr: "push",
	plex_yank: "yank",
	plex_sink: "sink",
	generic_json: "sink",
	jellyfin_sink: "sink",
	youtube_music: "yank",
	jellyfin_push: "push",
	audiobookshelf: "yank",
	ryot_browser_extension: "sink",
};

const deriveWebhookUrl = (integrationId: string): string =>
	`${config.frontendUrl}/_i/${integrationId}`;

const addWebhookUrl = (
	integration: ListedIntegration & { userId: string },
): ListedIntegration & { userId: string } => {
	if (isSinkProvider(integration.provider)) {
		return { ...integration, webhookUrl: deriveWebhookUrl(integration.id) };
	}
	return integration;
};

export const buildIntegrationInputSummary = (
	integration: Pick<ListedIntegration, "id" | "lot" | "name" | "provider">,
) => ({
	lot: integration.lot,
	integrationId: integration.id,
	provider: integration.provider,
	...(integration.name ? { name: integration.name } : {}),
});

export const validateProgressThresholds = (
	minimumProgress: number,
	maximumProgress: number,
): string | null => {
	if (minimumProgress < 0 || minimumProgress > 100) {
		return "minimumProgress must be between 0 and 100";
	}
	if (maximumProgress < 0 || maximumProgress > 100) {
		return "maximumProgress must be between 0 and 100";
	}
	if (minimumProgress > maximumProgress) {
		return "minimumProgress must not exceed maximumProgress";
	}
	return null;
};

export const createIntegration = async (input: {
	userId: string;
	body: CreateIntegrationBody;
}): Promise<IntegrationServiceResult<ListedIntegration>> => {
	const { body, userId } = input;

	if (body.providerSpecifics.kind !== body.provider) {
		return serviceError("validation", "providerSpecifics.kind must match provider");
	}

	const lot = providerLotMap[body.provider];

	const minimumProgress = body.minimumProgress ?? 2;
	const maximumProgress = body.maximumProgress ?? 95;
	const thresholdError = validateProgressThresholds(minimumProgress, maximumProgress);
	if (thresholdError) {
		return serviceError("validation", thresholdError);
	}

	const created = await createIntegrationRow({
		lot,
		userId,
		provider: body.provider,
		name: body.name ?? null,
		isDisabled: body.isDisabled ?? false,
		providerSpecifics: body.providerSpecifics,
		syncOwnership: body.syncOwnership ?? false,
		minimumProgress: minimumProgress.toString(),
		maximumProgress: maximumProgress.toString(),
		extraSettings: body.extraSettings ?? { disableOnContinuousErrors: false },
	});

	if (lot === "yank" && !created.isDisabled) {
		await addYankRepeatJob({ userId, integrationId: created.id });
	}

	return serviceData(addWebhookUrl(created));
};

export const getIntegration = async (input: {
	id: string;
	userId: string;
}): Promise<IntegrationServiceResult<ListedIntegration>> => {
	const found = await getIntegrationById({ id: input.id, userId: input.userId });
	if (!found) {
		return serviceError("not_found", "Integration not found");
	}
	return serviceData(addWebhookUrl(found));
};

export const listIntegrations = async (input: {
	userId: string;
	provider?: IntegrationProvider;
	isDisabled?: boolean;
}): Promise<IntegrationServiceResult<ListedIntegration[]>> => {
	const rows = await listIntegrationsByUser(input);
	return serviceData(rows.map(addWebhookUrl));
};

export const patchIntegration = async (input: {
	id: string;
	userId: string;
	body: PatchIntegrationBody;
}): Promise<IntegrationServiceResult<ListedIntegration>> => {
	const existing = await getIntegrationById({ id: input.id, userId: input.userId });
	if (!existing) {
		return serviceError("not_found", "Integration not found");
	}

	let finalProviderSpecifics = existing.providerSpecifics;
	if (input.body.providerSpecifics !== undefined) {
		const merged = { ...existing.providerSpecifics, ...input.body.providerSpecifics };
		const parsed = providerSpecificsSchema.safeParse(merged);
		if (!parsed.success) {
			return serviceError(
				"validation",
				`Invalid providerSpecifics after merge: ${parsed.error.message}`,
			);
		}
		finalProviderSpecifics = parsed.data;
	}

	const minimumProgress = input.body.minimumProgress ?? Number.parseFloat(existing.minimumProgress);
	const maximumProgress = input.body.maximumProgress ?? Number.parseFloat(existing.maximumProgress);
	const thresholdError = validateProgressThresholds(minimumProgress, maximumProgress);
	if (thresholdError) {
		return serviceError("validation", thresholdError);
	}

	const wasDisabled = existing.isDisabled;
	const nowDisabled = input.body.isDisabled ?? existing.isDisabled;

	const updated = await updateIntegrationRow({
		id: input.id,
		userId: input.userId,
		name: input.body.name,
		isDisabled: input.body.isDisabled,
		syncOwnership: input.body.syncOwnership,
		extraSettings: input.body.extraSettings,
		providerSpecifics: finalProviderSpecifics,
		minimumProgress: input.body.minimumProgress?.toString(),
		maximumProgress: input.body.maximumProgress?.toString(),
	});

	if (existing.lot === "yank") {
		if (!wasDisabled && nowDisabled) {
			await removeYankRepeatJob(input.id);
		} else if (wasDisabled && !nowDisabled) {
			await addYankRepeatJob({ userId: input.userId, integrationId: input.id });
		}
	}

	return serviceData(addWebhookUrl(updated));
};

export const deleteIntegration = async (input: {
	id: string;
	userId: string;
}): Promise<IntegrationServiceResult<void>> => {
	const existing = await getIntegrationById({ id: input.id, userId: input.userId });
	if (!existing) {
		return serviceError("not_found", "Integration not found");
	}
	if (existing.lot === "yank") {
		await removeYankRepeatJob(input.id);
	}
	await deleteIntegrationRow({ id: input.id, userId: input.userId });
	return serviceData(undefined);
};

export const listIntegrationRuns = async (input: {
	integrationId: string;
	userId: string;
}): Promise<
	IntegrationServiceResult<Awaited<ReturnType<typeof listIntegrationRunsByIntegrationId>>>
> => {
	const existing = await getIntegrationById({
		userId: input.userId,
		id: input.integrationId,
	});
	if (!existing) {
		return serviceError("not_found", "Integration not found");
	}
	const runs = await listIntegrationRunsByIntegrationId({
		userId: input.userId,
		integrationId: input.integrationId,
	});
	return serviceData(runs);
};

export const getUserDisableIntegrations = async (userId: string): Promise<boolean> => {
	const [row] = await db
		.select({ preferences: user.preferences })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	const parsed = userPreferencesSchema.safeParse(row?.preferences);
	return parsed.success ? parsed.data.disableIntegrations : false;
};

export const handleWebhook = async (input: {
	rawBody: string;
	contentType: string;
	integrationId: string;
}): Promise<{ runId: string } | { notFound: true } | { notSink: true }> => {
	const integration = await getIntegrationByIdAnyUser({ id: input.integrationId });
	if (!integration) {
		return { notFound: true };
	}
	if (integration.lot !== "sink") {
		return { notSink: true };
	}

	const inputSummary = buildIntegrationInputSummary(integration);

	const disableIntegrations = await getUserDisableIntegrations(integration.userId);

	if (disableIntegrations) {
		const run = await createImportRun({
			source: integration.provider,
			inputSummary,
			userId: integration.userId,
			integrationId: integration.id,
		});
		await failImportRun(run.id, "Integrations are disabled for this user");
		await recordImportRunFailure({
			itemIndex: 0,
			runId: run.id,
			stage: "source_fetch",
			message: "Integrations are disabled for this user",
		});
		return { runId: run.id };
	}

	if (integration.isDisabled) {
		const run = await createImportRun({
			source: integration.provider,
			inputSummary,
			userId: integration.userId,
			integrationId: integration.id,
		});
		await failImportRun(run.id, "Integration is disabled");
		await recordImportRunFailure({
			itemIndex: 0,
			runId: run.id,
			stage: "source_fetch",
			message: "Integration is disabled",
		});
		return { runId: run.id };
	}

	const run = await createImportRun({
		source: integration.provider,
		inputSummary,
		userId: integration.userId,
		integrationId: integration.id,
	});

	const { importQueue } = getQueues();
	await importQueue.add(integrationRunJobName, {
		runId: run.id,
		rawBody: input.rawBody,
		userId: integration.userId,
		integrationId: integration.id,
		contentType: input.contentType,
	});

	return { runId: run.id };
};

type AutoDisableDeps = {
	getIntegration: typeof getIntegrationById;
	removeYankJob: typeof removeYankRepeatJob;
	getLastRuns: typeof getLastNRunsForIntegration;
	updateIntegration: typeof updateIntegrationRow;
};

export const createCheckAndAutoDisable =
	(
		deps: AutoDisableDeps = {
			getIntegration: getIntegrationById,
			removeYankJob: removeYankRepeatJob,
			getLastRuns: getLastNRunsForIntegration,
			updateIntegration: updateIntegrationRow,
		},
	) =>
	async (input: { integrationId: string; userId: string }): Promise<void> => {
		const integration = await deps.getIntegration({
			userId: input.userId,
			id: input.integrationId,
		});
		if (!integration) {
			return;
		}
		if (!integration.extraSettings.disableOnContinuousErrors) {
			return;
		}
		const lastRuns = await deps.getLastRuns({
			count: 5,
			integrationId: input.integrationId,
		});
		if (lastRuns.length < 5) {
			return;
		}
		const allFailed = lastRuns.every((r) => r.status === "failed");
		if (!allFailed) {
			return;
		}
		await deps.updateIntegration({
			isDisabled: true,
			userId: input.userId,
			id: input.integrationId,
		});
		if (integration.lot === "yank") {
			await deps.removeYankJob(input.integrationId);
		}
	};

export const checkAndAutoDisable = createCheckAndAutoDisable();
