import { Activity } from "@effect/workflow";
import { Effect, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner } from "#lib/infrastructure/db/service";
import { EntitiesRepository } from "#modules/entities/repository";

import type { ImportRunJobData } from "../jobs";
import { recordImportRunFailure } from "../runtime/import-run-status";
import { makeImporterConfig } from "../runtime/importer-config";
import { ImportRunError, toWorkflowError } from "../runtime/workflow-helpers";
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
	const runWithDb = yield* DbRunner;
	const entitiesRepository = yield* EntitiesRepository;
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

		const candidateScripts = yield* Activity.make({
			error: ImportRunError,
			name: `load-resolution-candidates-${i}`,
			success: Schema.Array(ResolutionCandidate),
			execute: Effect.forEach(
				candidates,
				(scriptSlug) =>
					runWithDb(entitiesRepository.findEntitySchemaSandboxScriptBySlug(scriptSlug)).pipe(
						Effect.map((script) => ({
							scriptSlug,
							sandboxScriptId: script?.sandboxScriptId ?? null,
						})),
					),
				{ concurrency: 1 },
			).pipe(Effect.mapError(toWorkflowError)),
		});

		const lookupErrors: string[] = [];
		let resolved = false;

		for (let candidateIndex = 0; candidateIndex < candidateScripts.length; candidateIndex += 1) {
			const candidate = candidateScripts[candidateIndex];
			if (!candidate) {
				continue;
			}

			if (!candidate.sandboxScriptId) {
				lookupErrors.push(`${candidate.scriptSlug}: sandbox script not found`);
				continue;
			}

			const result = yield* operations
				.resolveExternalId({
					value: ref.identifierValue,
					userId: input.payload.userId,
					identifierType: ref.identifierType,
					scriptId: candidate.sandboxScriptId,
					executionId: `${input.executionId}-resolve-${i}-${candidateIndex}`,
				})
				.pipe(Effect.either);

			if (result._tag === "Left") {
				lookupErrors.push(`${candidate.scriptSlug}: ${result.left.message}`);
				continue;
			}

			if (result.right.externalId) {
				group.entityRef = {
					kind: "resolved",
					sourceLabel: ref.sourceLabel,
					scriptSlug: candidate.scriptSlug,
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
