import { Activity } from "@effect/workflow";
import { Effect, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";

import type { ImportRunJobData } from "../jobs";
import { recordImportRunFailure } from "../runtime/import-run-status";
import { makeImporterConfig } from "../runtime/importer-config";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-errors";
import { mediaEntityGroupItemIndex } from "./groups";
import { getResolutionCandidates } from "./resolution-candidates";
import { ResolutionCandidate, type ProgressReporter } from "./shared-workflow";
import type { ImportEntityRef, ImportMediaEntityGroup } from "./types";
import { MediaImportWorkflowOperations } from "./types-workflow";

export const resolveMediaEntityGroups = Effect.fn("resolveMediaEntityGroups")(function* (input: {
	executionId: string;
	reportProgress: ProgressReporter;
	entityGroups: ImportMediaEntityGroup[];
	payload: Pick<ImportRunJobData, "runId" | "userId">;
}) {
	const config = yield* AppConfig;
	const operations = yield* MediaImportWorkflowOperations;
	const importer = makeImporterConfig(config);
	let failures = 0;

	for (let i = 0; i < input.entityGroups.length; i += 1) {
		const group = input.entityGroups[i];
		const ref = group?.entityRef;
		if (!group || !ref || ref.kind === "resolved") {
			yield* input.reportProgress(i + 1);
			continue;
		}

		const candidates = getResolutionCandidates({
			importer,
			identifierType: ref.identifierType,
			entitySchemaSlug: ref.entitySchemaSlug,
		});
		if (candidates.length === 0) {
			failures += 1;
			yield* recordResolutionFailure({
				i,
				ref,
				group,
				payload: input.payload,
				context: { identifierType: ref.identifierType },
				message: `No providers configured to resolve ${ref.identifierType}`,
			});
			yield* input.reportProgress(i + 1);
			continue;
		}

		const candidateProviders = yield* Activity.make({
			error: ImportRunError,
			name: `load-resolution-candidates-${i}`,
			success: Schema.Array(ResolutionCandidate),
			execute: Effect.forEach(
				candidates,
				(providerSlug) =>
					operations.resolveProvider(providerSlug).pipe(
						Effect.map((provider) => ({
							providerSlug,
							providerId: provider?.providerId ?? null,
						})),
					),
				{ concurrency: 1 },
			).pipe(Effect.mapError(toWorkflowError)),
		});

		const lookupErrors: string[] = [];
		let resolved = false;

		for (let candidateIndex = 0; candidateIndex < candidateProviders.length; candidateIndex += 1) {
			const candidate = candidateProviders[candidateIndex];
			if (!candidate) {
				continue;
			}

			if (!candidate.providerId) {
				lookupErrors.push(`${candidate.providerSlug}: provider not found`);
				continue;
			}

			const result = yield* operations
				.resolveExternalId({
					value: ref.identifierValue,
					userId: input.payload.userId,
					identifierType: ref.identifierType,
					providerId: candidate.providerId,
					executionId: `${input.executionId}-resolve-${i}-${candidateIndex}`,
				})
				.pipe(Effect.either);

			if (result._tag === "Left") {
				lookupErrors.push(`${candidate.providerSlug}: ${result.left.message}`);
				continue;
			}

			if (result.right.externalId) {
				group.entityRef = {
					kind: "resolved",
					sourceLabel: ref.sourceLabel,
					providerSlug: candidate.providerSlug,
					externalId: result.right.externalId,
					entitySchemaSlug: ref.entitySchemaSlug,
				} satisfies Extract<ImportEntityRef, { kind: "resolved" }>;
				resolved = true;
				break;
			}
		}

		if (!resolved) {
			failures += 1;
			yield* recordResolutionFailure({
				i,
				ref,
				group,
				context: lookupErrors.length > 0 ? { errors: lookupErrors } : null,
				payload: input.payload,
				message:
					lookupErrors.length > 0
						? lookupErrors.join("; ")
						: `Could not resolve ${ref.identifierType} to a supported provider`,
			});
		}

		yield* input.reportProgress(i + 1);
	}

	return failures;
});

const recordResolutionFailure = (input: {
	i: number;
	message: string;
	group: ImportMediaEntityGroup;
	context: Record<string, unknown> | null;
	payload: Pick<ImportRunJobData, "runId">;
	ref: Extract<ImportEntityRef, { kind: "unresolved" }>;
}) =>
	Activity.make({
		error: ImportRunError,
		name: `record-resolution-failure-${input.i}`,
		execute: recordImportRunFailure({
			message: input.message,
			context: input.context,
			runId: input.payload.runId,
			stage: "provider_resolution",
			sourceLabel: input.ref.sourceLabel,
			sourceIdentifier: input.ref.identifierValue,
			entitySchemaSlug: input.ref.entitySchemaSlug,
			itemIndex: mediaEntityGroupItemIndex(input.group, input.i),
		}).pipe(Effect.mapError(toWorkflowError)),
	});
