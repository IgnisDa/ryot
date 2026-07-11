import { Activity } from "@effect/workflow";
import type { AutomationOrigin } from "@ryot/contract/modules/automations/schemas";
import type { IntegrationId } from "@ryot/contract/schema/brands";
import { Effect, Schema } from "effect";

import type { ImportRunJobData } from "../jobs";
import { recordImportRunFailure } from "../runtime/import-run-status";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-errors";
import { mediaEntityGroupItemIndex } from "./groups";
import { PopulationProvider, type EntityIdsByKey, type ProgressReporter } from "./shared-workflow";
import type { ImportMediaEntityGroup } from "./types";
import { importEntityRefKey } from "./types";
import { MediaImportWorkflowOperations } from "./types-workflow";

export const populateMediaEntityGroups = Effect.fn("populateMediaEntityGroups")(function* (input: {
	executionId: string;
	reportProgress: ProgressReporter;
	entityGroups: ImportMediaEntityGroup[];
	payload: Pick<ImportRunJobData, "runId" | "userId"> & { integrationId?: IntegrationId };
}) {
	const operations = yield* MediaImportWorkflowOperations;
	const entityIdsByKey: EntityIdsByKey = new Map();
	let failures = 0;

	for (let i = 0; i < input.entityGroups.length; i += 1) {
		const group = input.entityGroups[i];
		const ref = group?.entityRef;
		if (!group || ref?.kind !== "resolved") {
			yield* input.reportProgress(i + 1);
			continue;
		}

		const itemIndex = mediaEntityGroupItemIndex(group, i);
		const provider = yield* Activity.make({
			error: ImportRunError,
			name: `load-population-script-${i}`,
			success: Schema.NullOr(PopulationProvider),
			execute: operations.resolveProvider(ref.providerSlug).pipe(Effect.mapError(toWorkflowError)),
		});

		if (!provider) {
			failures += 1;
			yield* Activity.make({
				error: ImportRunError,
				name: `record-populate-script-failure-${i}`,
				execute: recordImportRunFailure({
					itemIndex,
					context: null,
					runId: input.payload.runId,
					sourceLabel: ref.sourceLabel,
					stage: "input_transformation",
					sourceIdentifier: ref.externalId,
					entitySchemaSlug: ref.entitySchemaSlug,
					message: `Provider not found for slug: ${ref.providerSlug}`,
				}).pipe(Effect.mapError(toWorkflowError)),
			});
			yield* input.reportProgress(i + 1);
			continue;
		}

		const populated = yield* operations
			.importEntity({
				externalId: ref.externalId,
				userId: input.payload.userId,
				providerId: provider.providerId,
				entitySchemaSlug: provider.entitySchemaSlug,
				executionId: `${input.executionId}-entity-${i}`,
				origin: (input.payload.integrationId
					? {
							kind: "integration",
							integrationId: input.payload.integrationId,
							importRunId: input.payload.runId,
						}
					: { kind: "import", importRunId: input.payload.runId }) satisfies AutomationOrigin,
			})
			.pipe(Effect.either);

		if (populated._tag === "Left") {
			failures += 1;
			const stage = populated.left.stage === "membership" ? "database_commit" : "provider_details";
			yield* Activity.make({
				error: ImportRunError,
				name: `record-populate-failure-${i}`,
				execute: recordImportRunFailure({
					stage,
					itemIndex,
					context: null,
					runId: input.payload.runId,
					sourceLabel: ref.sourceLabel,
					message: populated.left.message,
					sourceIdentifier: ref.externalId,
					entitySchemaSlug: ref.entitySchemaSlug,
				}).pipe(Effect.mapError(toWorkflowError)),
			});
			yield* input.reportProgress(i + 1);
			continue;
		}

		entityIdsByKey.set(importEntityRefKey(ref), populated.right.id);
		yield* input.reportProgress(i + 1);
	}

	return { failures, entityIdsByKey };
});
