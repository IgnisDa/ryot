import type { Job } from "bullmq";
import { match } from "ts-pattern";

import { getIntegrationByIdAnyUser } from "~/modules/integrations/repository";

import { integrationRunJobData, integrationRunJobName } from "./jobs";
import { checkAndAutoDisable } from "./service";

export { integrationRunJobName };

export const processIntegrationQueueJob = async (job: Job): Promise<void> => {
	if (job.name !== integrationRunJobName) {
		return;
	}
	const parsed = integrationRunJobData.safeParse(job.data);
	if (!parsed.success) {
		throw new Error("Integration run job payload is invalid");
	}
	const { userId, integrationId } = parsed.data;

	const integration = await getIntegrationByIdAnyUser({ id: integrationId });
	if (!integration) {
		throw new Error(`Integration ${integrationId} not found`);
	}

	// Delegate to lot-specific handler (filled in tasks 05 and 06)
	match(integration.lot)
		.with("yank", () => {
			throw new Error(`Yank handler not yet implemented for provider: ${integration.provider}`);
		})
		.with("sink", () => {
			throw new Error(`Sink handler not yet implemented for provider: ${integration.provider}`);
		})
		.with("push", () => {
			// Push integrations are handled by sandbox triggers, not the worker
		})
		.exhaustive();

	await checkAndAutoDisable({ integrationId, userId });
};
