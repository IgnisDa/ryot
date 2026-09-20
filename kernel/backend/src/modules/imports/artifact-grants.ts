import { SandboxRunError } from "@ryot-app/contract/errors";
import type {
	SandboxExecutionGrants,
	SandboxExecutionSubject,
} from "@ryot-app/contract/modules/sandbox/schemas";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { ingestionArtifactsSchema } from "@ryot-app/sandbox-sdk/imports";
import { isObjectRecord } from "@ryot-app/ts-utils/predicates";
import { Effect, Schema } from "effect";

import { SandboxArtifactStore } from "#lib/infrastructure/sandbox-runtime/artifacts";

import { IngestionCaptures } from "./capture-service";
import { ImportsRepository } from "./repository";

export const ingestionArtifactGrants = Effect.fn("imports.ingestionArtifactGrants")(function* (
	input: unknown,
	subject: SandboxExecutionSubject,
	grants: SandboxExecutionGrants | undefined,
) {
	if (!isObjectRecord(input)) {
		return grants;
	}
	if (typeof input["artifactHandle"] === "string") {
		if (!grants?.artifactOwnerExecutionId) {
			return yield* new SandboxRunError({
				kind: "invalid-input",
				message: "Artifact owner is unavailable",
			});
		}
		if (input["artifactHandle"].startsWith("staged-")) {
			if (subject.type === "system") {
				return yield* new SandboxRunError({
					kind: "invalid-input",
					message: "Staged artifact owner is unavailable",
				});
			}
			const userId = subject.type === "user" ? subject.userId : subject.executionUserId;
			if (!userId || !subject.accountGeneration) {
				return yield* new SandboxRunError({
					kind: "invalid-input",
					message: "Staged artifact owner is unavailable",
				});
			}
			const repository = yield* ImportsRepository;
			const run = yield* repository.getStagingOwner(
				userId,
				subject.accountGeneration,
				grants.artifactOwnerExecutionId,
			);
			if (run?.status !== "running") {
				return yield* new SandboxRunError({
					kind: "invalid-input",
					message: "Staged artifact is not owned by this execution",
				});
			}
			const captures = yield* IngestionCaptures;
			const artifactPath = yield* captures.resolveStaged(
				{ userId, runId: ImportRunId.make(run.id), accountGeneration: subject.accountGeneration },
				grants.artifactOwnerExecutionId,
				input["artifactHandle"],
			);
			return { ...grants, artifactPath };
		}
		const artifacts = yield* SandboxArtifactStore;
		const [artifactPath] = yield* artifacts.resolveOutputs(grants.artifactOwnerExecutionId, [
			input["artifactHandle"],
		]);
		return { ...grants, ...(artifactPath ? { artifactPath } : {}) };
	}
	if (!isObjectRecord(input["ingestionArtifact"]) && !isObjectRecord(input["ingestionArtifacts"])) {
		return grants;
	}
	const single = input["ingestionArtifact"];
	const multiple = input["ingestionArtifacts"];
	if (single !== undefined && multiple !== undefined) {
		return yield* new SandboxRunError({
			kind: "invalid-input",
			message: "Ingestion artifact scope is invalid",
		});
	}
	const request = isObjectRecord(single) ? single : multiple;
	if (!isObjectRecord(request)) {
		return grants;
	}
	const { runId } = request;
	const entries: Array<[string, string]> = [];
	if (isObjectRecord(single)) {
		if (typeof single["captureId"] !== "string") {
			return yield* new SandboxRunError({
				kind: "invalid-input",
				message: "Ingestion artifact scope is invalid",
			});
		}
		entries.push(["", single["captureId"]]);
	} else {
		const selection = yield* Schema.decodeUnknownEffect(ingestionArtifactsSchema)(multiple).pipe(
			Effect.mapError(
				() =>
					new SandboxRunError({
						kind: "invalid-input",
						message: "Ingestion artifact scope is invalid",
					}),
			),
		);
		entries.push(...Object.entries(selection.captures));
	}
	if (typeof runId !== "string" || subject.type === "system") {
		return yield* new SandboxRunError({
			kind: "invalid-input",
			message: "Ingestion artifact scope is invalid",
		});
	}
	const userId = subject.type === "user" ? subject.userId : subject.executionUserId;
	if (!userId || !subject.accountGeneration) {
		return yield* new SandboxRunError({
			kind: "invalid-input",
			message: "Ingestion artifact requires an account owner",
		});
	}
	const scope = {
		userId,
		runId: ImportRunId.make(runId),
		accountGeneration: subject.accountGeneration,
	};
	const repository = yield* ImportsRepository;
	const run = yield* repository.getIngestionRun(scope);
	if (run?.status !== "running" || run.pins?.executionId !== grants?.artifactOwnerExecutionId) {
		return yield* new SandboxRunError({
			kind: "invalid-input",
			message: "Ingestion artifact is not owned by this execution",
		});
	}
	for (const [, captureId] of entries) {
		const capture = yield* repository.getCapture(scope, captureId);
		if (!capture || capture.ordinal < 64) {
			return yield* new SandboxRunError({
				kind: "invalid-input",
				message: "Ingestion artifact is not owned by this execution",
			});
		}
	}
	const captures = yield* IngestionCaptures;
	const namedArtifactPaths: Record<string, string> = {};
	for (const [key, captureId] of entries) {
		const artifactPath = yield* captures.materialize(scope, captureId, 4 * 1024 * 1024);
		if (single !== undefined) {
			return { ...grants, artifactPath };
		}
		Object.defineProperty(namedArtifactPaths, key, { enumerable: true, value: artifactPath });
	}
	return {
		...grants,
		namedArtifactPaths: { ...grants?.namedArtifactPaths, ...namedArtifactPaths },
	};
});
