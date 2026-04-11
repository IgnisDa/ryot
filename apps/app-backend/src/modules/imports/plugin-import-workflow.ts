import { Activity } from "@effect/workflow";
import { unknownToMessage } from "@ryot/contract/errors";
import type { SandboxExecutionGrants } from "@ryot/contract/modules/sandbox/schemas";
import { genericImportWorkflowInputSchema } from "@ryot/sandbox-sdk/imports";
import { jsonValueSchema, type JsonValue } from "@ryot/sandbox-sdk/wire";
import { Cause, Effect, Schema } from "effect";

import { AppConfig } from "#lib/infrastructure/config/service";
import type { RegisteredImportSource } from "#modules/plugins/import-source-catalog";
import { SandboxExecutionService } from "#modules/sandbox/service";

import type { ImportRunJobData } from "./jobs";
import { resolveImportPath } from "./runtime/import-files";
import { markImportRunStarted } from "./runtime/import-run-status";
import { loadImportSourcePayload } from "./runtime/source-payload-store";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";
import { createImportRunLifecycle } from "./runtime/workflow-helpers";

export const runPluginImportWorkflow = Effect.fn("runPluginImportWorkflow")(function* (
	payload: ImportRunJobData,
	executionId: string,
	source: RegisteredImportSource,
) {
	const config = yield* AppConfig;
	const sandbox = yield* SandboxExecutionService;
	const namedArtifactPaths: Record<string, string> = {};
	const cleanupPaths: string[] = [];
	if (source.input === "file" && source.lot === "named") {
		for (const artifact of source.artifacts) {
			const suppliedPath = payload.namedArtifactPaths?.[artifact.key];
			if (!suppliedPath) {
				continue;
			}
			const [resolvedPath] = yield* resolveImportPath(suppliedPath, config.tmpDir);
			if (resolvedPath) {
				namedArtifactPaths[artifact.key] = resolvedPath;
				cleanupPaths.push(resolvedPath);
			}
		}
	} else if (source.input === "file" && payload.filePath) {
		cleanupPaths.push(...(yield* resolveImportPath(payload.filePath, config.tmpDir)));
	}
	const artifactPath =
		source.input === "file" && source.lot === "single" ? cleanupPaths[0] : undefined;
	let grants: SandboxExecutionGrants | undefined;
	if (artifactPath) {
		grants = { artifactPath };
	} else if (Object.keys(namedArtifactPaths).length > 0) {
		grants = { namedArtifactPaths };
	}
	const { failRunAndCleanup, cleanupArtifactsBestEffort, cleanupHarvestedDirectoriesBestEffort } =
		createImportRunLifecycle(payload);

	const processWorkflow = Effect.gen(function* () {
		yield* Activity.make({
			error: ImportRunError,
			name: "mark-import-run-started",
			execute: markImportRunStarted(payload.runId).pipe(Effect.mapError(toWorkflowError)),
		});

		const scriptId = yield* sandbox
			.resolveWorkflowScript({
				executionId,
				pluginSlug: source.pluginSlug,
				workflowSlug: source.workflowSlug,
			})
			.pipe(Effect.mapError(toWorkflowError));
		const storedSourcePayload = payload.sourcePayloadKey
			? yield* Activity.make({
					error: ImportRunError,
					name: "load-import-source-payload",
					success: Schema.NullOr(Schema.Record({ key: Schema.String, value: jsonValueSchema })),
					execute: loadImportSourcePayload(payload.sourcePayloadKey).pipe(
						Effect.mapError(toWorkflowError),
					),
				})
			: null;
		const sourcePayload = payload.sourcePayload ?? storedSourcePayload ?? undefined;
		const workflowInput = yield* Schema.encode(genericImportWorkflowInputSchema)({
			runId: payload.runId,
			source: payload.source,
			...(sourcePayload ? { sourcePayload } : {}),
		}).pipe(
			Effect.flatMap(Schema.decodeUnknown(jsonValueSchema)),
			Effect.mapError(toWorkflowError),
		) satisfies Effect.Effect<JsonValue, ImportRunError>;

		yield* sandbox
			.executeWorkflow({
				scriptId,
				input: workflowInput,
				...(grants ? { grants } : {}),
				executionId: `${executionId}-import`,
				authority: { type: "user", userId: payload.userId },
			})
			.pipe(Effect.mapError(toWorkflowError));

		yield* cleanupArtifactsBestEffort("cleanup-import-artifacts-on-success", cleanupPaths);
	});

	yield* processWorkflow.pipe(
		Effect.catchAllCause((cause) =>
			cleanupHarvestedDirectoriesBestEffort(
				"cleanup-import-harvest-on-failure",
				`${executionId}-import-activity-`,
			).pipe(
				Effect.zipRight(
					failRunAndCleanup({
						cleanupPaths,
						failureName: "fail-import-run-unexpected",
						message: unknownToMessage(Cause.squash(cause)),
						cleanupName: "cleanup-import-artifacts-on-unexpected-failure",
					}),
				),
			),
		),
	);
});
