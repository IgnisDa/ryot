import { strCronSyntax } from "english-to-cron";

import { config } from "~/lib/config";
import { getQueues } from "~/lib/queue";

import { integrationRunJobName } from "./jobs";
import { listAllEnabledYankIntegrations } from "./repository";

const buildSchedulerId = (integrationId: string) => `yank-${integrationId}`;

const parseCronSchedule = (): string => {
	const phrase = config.scheduler.frequentCronJobsSchedule;
	return strCronSyntax(phrase);
};

export const addYankRepeatJob = async (input: {
	userId: string;
	integrationId: string;
}): Promise<void> => {
	const { importQueue } = getQueues();
	const schedulerId = buildSchedulerId(input.integrationId);
	await importQueue.upsertJobScheduler(
		schedulerId,
		{ pattern: parseCronSchedule() },
		{
			name: integrationRunJobName,
			data: {
				runId: "",
				userId: input.userId,
				integrationId: input.integrationId,
			},
		},
	);
};

export const removeYankRepeatJob = async (integrationId: string): Promise<void> => {
	const { importQueue } = getQueues();
	await importQueue.removeJobScheduler(buildSchedulerId(integrationId));
};

export const reconcileIntegrationScheduler = async (): Promise<void> => {
	const { importQueue } = getQueues();
	const cronExpression = parseCronSchedule();

	const [enabledYankIntegrations, existingSchedulers] = await Promise.all([
		listAllEnabledYankIntegrations(),
		importQueue.getJobSchedulers(),
	]);

	const enabledIntegrationIds = new Set(enabledYankIntegrations.map((i) => i.id));

	// Remove only schedulers whose integration is gone or disabled; upsert-ing the rest applies cron
	// changes without removing and re-adding the same scheduler in one pass, which could race.
	const schedulersToRemove = existingSchedulers.filter((s) => {
		if (!s.id?.startsWith("yank-")) {
			return false;
		}
		const integrationId = s.id.replace("yank-", "");
		return !integrationId || !enabledIntegrationIds.has(integrationId);
	});

	await Promise.all(schedulersToRemove.map((s) => importQueue.removeJobScheduler(s.id ?? s.key)));

	await Promise.all(
		enabledYankIntegrations.map((i) =>
			importQueue.upsertJobScheduler(
				buildSchedulerId(i.id),
				{ pattern: cronExpression },
				{
					name: integrationRunJobName,
					data: { runId: "", userId: i.userId, integrationId: i.id },
				},
			),
		),
	);

	console.info(
		`Integration scheduler reconciled: ${enabledYankIntegrations.length} active Yank integrations`,
	);
};
