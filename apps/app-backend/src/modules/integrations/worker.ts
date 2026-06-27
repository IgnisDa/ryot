import type { ImportRunId } from "@ryot/contract/schema/brands";
import { DateTime, Effect } from "effect";

import { ImportsRepository } from "#modules/imports/repository";

import type { IntegrationRecord } from "./repository";
import { IntegrationsService } from "./service";

export const finalizeIntegrationRun = Effect.fn("integrationsWorker.finalizeIntegrationRun")(
	function* (integration: IntegrationRecord, runId: ImportRunId) {
		const repository = yield* ImportsRepository;
		const integrationsService = yield* IntegrationsService;

		const run = yield* repository.getRunById({ runId, userId: integration.userId });
		if (run?.status === "completed") {
			const finishedAt = yield* DateTime.nowAsDate;
			yield* integrationsService.update(integration.userId, integration.id, {
				lastFinishedAt: finishedAt,
			});
		}

		if (!integration.extraSettings.disableOnContinuousErrors) {
			return false;
		}

		const lastRuns = yield* repository.listRecentStatusesByIntegrationId({
			integrationId: integration.id,
			limit: 5,
		});
		if (lastRuns.length < 5 || lastRuns.some((candidate) => candidate.status !== "failed")) {
			return false;
		}

		return yield* integrationsService.disableIfEnabled(integration.userId, integration.id, runId);
	},
);
