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
			data: { runId: "", userId: input.userId, integrationId: input.integrationId },
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

	const existingYankSchedulers = existingSchedulers.filter((s) => s.id?.startsWith("yank-"));

	const enabledIntegrationIds = new Set(enabledYankIntegrations.map((i) => i.id));

	const schedulersToRemove = existingYankSchedulers.filter((s) => {
		const integrationId = s.id?.replace("yank-", "");
		return (
			!integrationId || !enabledIntegrationIds.has(integrationId) || s.pattern !== cronExpression
		);
	});

	const existingCurrentSchedulerIds = new Set(
		existingYankSchedulers
			.filter((s) => s.pattern === cronExpression)
			.map((s) => s.id?.replace("yank-", ""))
			.filter(Boolean),
	);

	const integrationIdsToAdd = enabledYankIntegrations.filter(
		(i) => !existingCurrentSchedulerIds.has(i.id),
	);

	await Promise.all([
		...schedulersToRemove.map((s) => importQueue.removeJobScheduler(s.id ?? s.key)),
		...integrationIdsToAdd.map((i) =>
			importQueue.upsertJobScheduler(
				buildSchedulerId(i.id),
				{ pattern: cronExpression },
				{
					name: integrationRunJobName,
					data: { runId: "", userId: i.userId, integrationId: i.id },
				},
			),
		),
	]);

	console.info(
		`Integration scheduler reconciled: ${enabledYankIntegrations.length} active Yank integrations`,
	);
};
