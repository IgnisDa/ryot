import type { ImportRunId } from "@ryot-app/contract/schema/brands";
import { DateTime, Effect } from "effect";

import { ImportsRepository } from "#modules/imports/repository";

import { isIntegrationSourceFailure } from "./health";
import { IntegrationsRepository, type IntegrationRecord } from "./repository";
import { IntegrationsService } from "./service";

export const finalizeIntegrationRun = Effect.fn("integrationsWorker.finalizeIntegrationRun")(
	function* (integration: IntegrationRecord, runId: ImportRunId) {
		const repository = yield* ImportsRepository;
		const integrationsService = yield* IntegrationsService;
		const integrations = yield* IntegrationsRepository;

		const run = yield* repository.getRunById({ runId, userId: integration.userId });
		if (run?.status === "completed" && run.finishedAt !== null) {
			yield* integrationsService.recordRunFinished({
				userId: integration.userId,
				integrationId: integration.id,
				finishedAt: DateTime.toDateUtc(DateTime.makeUnsafe(run.finishedAt)),
			});
		}

		if (
			!run ||
			!isIntegrationSourceFailure(run) ||
			!integration.extraSettings.disableOnContinuousErrors
		) {
			return false;
		}

		const lastRuns = yield* integrations.listRecentHealthStatuses({
			userId: integration.userId,
			integrationId: integration.id,
		});
		if (lastRuns.length < 5 || lastRuns.some((candidate) => candidate.status !== "failed")) {
			return false;
		}

		return yield* integrationsService.disableIfEnabled(integration.userId, integration.id, runId);
	},
);
