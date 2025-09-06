import type { Job } from "bullmq";

import { resolveGlobalEntityExternalId } from "~/modules/entities/population";
import { getBuiltinSandboxScriptBySlug } from "~/modules/sandbox";

import type { ImportMediaEntityGroup, ImportRunJobData } from "../jobs";
import { createImportRunFailure } from "../repository";
import { getResolutionCandidates } from "./resolution-candidates";

type MediaEntityResolutionDeps = {
	getResolutionCandidates: typeof getResolutionCandidates;
	createImportRunFailure: typeof createImportRunFailure;
	resolveGlobalEntityExternalId: typeof resolveGlobalEntityExternalId;
	getBuiltinSandboxScriptBySlug: typeof getBuiltinSandboxScriptBySlug;
};

const mediaEntityResolutionDeps: MediaEntityResolutionDeps = {
	createImportRunFailure,
	getResolutionCandidates,
	resolveGlobalEntityExternalId,
	getBuiltinSandboxScriptBySlug,
};

export const resolveMediaEntityRefs = async (
	job: Job,
	token: string | undefined,
	input: {
		runId: string;
		userId: string;
		failedIndices: number[];
		startEntityIndex: number;
		adapterFailureCount: number;
		startCandidateIndex: number;
		jobData?: Partial<ImportRunJobData>;
		currentSandboxJobId: string | undefined;
		entityGroups: ImportMediaEntityGroup[];
		onEntityProcessed?: (processedCount: number) => Promise<void>;
	},
	deps: MediaEntityResolutionDeps = mediaEntityResolutionDeps,
): Promise<{ failedIndices: number[]; entityGroups: ImportMediaEntityGroup[] }> => {
	const failedIndices = [...input.failedIndices];
	const entityGroups = input.entityGroups.map((group) => ({ ...group }));
	const getProviderEntityRefs = () => entityGroups.map((group) => group.entityRef);

	const baseSnapshot = {
		...input.jobData,
		runId: input.runId,
		userId: input.userId,
		mediaEntityGroups: entityGroups,
		resolveFailedIndices: failedIndices,
		importStep: "resolving_entities" as const,
		adapterFailureCount: input.adapterFailureCount,
	};
	const recordEntityProcessed = async (index: number) => {
		await input.onEntityProcessed?.(input.adapterFailureCount + (index + 1));
	};

	// oxlint-disable no-await-in-loop
	for (let i = input.startEntityIndex; i < entityGroups.length; i++) {
		const group = entityGroups[i];
		const ref = group?.entityRef;
		if (!group || !ref || ref.kind === "resolved") {
			await recordEntityProcessed(i);
			continue;
		}

		const candidates = deps.getResolutionCandidates(ref.identifierType);
		if (candidates.length === 0) {
			failedIndices.push(i);
			await deps.createImportRunFailure({
				itemIndex: i,
				runId: input.runId,
				stage: "provider_resolution",
				sourceLabel: ref.sourceLabel,
				sourceIdentifier: ref.identifierValue,
				entitySchemaSlug: ref.entitySchemaSlug,
				context: { identifierType: ref.identifierType },
				message: `No providers configured to resolve ${ref.identifierType}`,
			});
			await job.updateData({
				...baseSnapshot,
				resolveCandidateIndex: 0,
				resolveEntityIndex: i + 1,
				resolveFailedIndices: failedIndices,
				providerEntityRefs: getProviderEntityRefs(),
			});
			await recordEntityProcessed(i);
			continue;
		}

		const lookupErrors: string[] = [];
		let resolved = false;

		const startCandidate = i === input.startEntityIndex ? input.startCandidateIndex : 0;
		for (
			let candidateIndex = startCandidate;
			candidateIndex < candidates.length;
			candidateIndex++
		) {
			const scriptSlug = candidates[candidateIndex];
			if (!scriptSlug) {
				continue;
			}

			const script = await deps.getBuiltinSandboxScriptBySlug(scriptSlug);
			if (!script) {
				lookupErrors.push(`${scriptSlug}: sandbox script not found`);
				continue;
			}

			const sandboxChildJobId = `${job.id}_sandbox_resolve_${i}_${candidateIndex}`;
			const sandboxAlreadyQueued =
				i === input.startEntityIndex &&
				candidateIndex === startCandidate &&
				input.currentSandboxJobId !== undefined;

			const result = await deps.resolveGlobalEntityExternalId(job, token, {
				sandboxChildJobId,
				scriptId: script.id,
				userId: input.userId,
				sandboxAlreadyQueued,
				value: ref.identifierValue,
				identifierType: ref.identifierType,
				updatedJobData: {
					...baseSnapshot,
					resolveEntityIndex: i,
					resolveCandidateIndex: candidateIndex,
					resolveSandboxJobId: sandboxChildJobId,
					providerEntityRefs: getProviderEntityRefs(),
				},
			});

			if ("error" in result) {
				lookupErrors.push(`${scriptSlug}: ${result.error.message}`);
				continue;
			}

			if (result.externalId) {
				group.entityRef = {
					scriptSlug,
					kind: "resolved",
					sourceLabel: ref.sourceLabel,
					externalId: result.externalId,
					entitySchemaSlug: ref.entitySchemaSlug,
				};
				resolved = true;
				break;
			}
		}

		if (!resolved) {
			failedIndices.push(i);
			await deps.createImportRunFailure({
				itemIndex: i,
				runId: input.runId,
				stage: "provider_resolution",
				sourceLabel: ref.sourceLabel,
				sourceIdentifier: ref.identifierValue,
				entitySchemaSlug: ref.entitySchemaSlug,
				context: lookupErrors.length > 0 ? { errors: lookupErrors } : null,
				message:
					lookupErrors.length > 0
						? lookupErrors.join("; ")
						: `Could not resolve ${ref.identifierType} to a supported provider`,
			});
		}

		await job.updateData({
			...baseSnapshot,
			resolveCandidateIndex: 0,
			resolveEntityIndex: i + 1,
			resolveFailedIndices: failedIndices,
			providerEntityRefs: getProviderEntityRefs(),
		});
		await recordEntityProcessed(i);
	}
	// oxlint-enable no-await-in-loop

	return { entityGroups, failedIndices };
};
