import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { DemoAccessPolicy } from "../../http-annotations";
import { BackupRunId } from "../../schema/brands";
import {
	BackupBadRequest,
	BackupConflict,
	BackupInternalError,
	BackupNotFound,
	BackupRun,
	BackupRunIdResponse,
	CreateRestoreBody,
	ListRunsResponse,
} from "./schemas";

export const BackupsGroup = HttpApiGroup.make("backups")
	.annotate(OpenApi.Description, "Manages backup export and restore runs")
	.add(
		HttpApiEndpoint.post("createExport", "/backups/exports", {
			success: BackupRunIdResponse.pipe(HttpApiSchema.status(201)),
			error: [
				BackupConflict.pipe(HttpApiSchema.status(409)),
				BackupBadRequest.pipe(HttpApiSchema.status(400)),
				BackupInternalError.pipe(HttpApiSchema.status(500)),
			],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Starts a backup export"),
	)
	.add(
		HttpApiEndpoint.get("listRuns", "/backups/runs", {
			success: ListRunsResponse,
			error: [
				BackupBadRequest.pipe(HttpApiSchema.status(400)),
				BackupInternalError.pipe(HttpApiSchema.status(500)),
			],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Lists backup runs"),
	)
	.add(
		HttpApiEndpoint.get("getRun", "/backups/runs/:id", {
			success: BackupRun,
			params: { id: BackupRunId },
			error: [
				BackupBadRequest.pipe(HttpApiSchema.status(400)),
				BackupNotFound.pipe(HttpApiSchema.status(404)),
				BackupInternalError.pipe(HttpApiSchema.status(500)),
			],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Gets a backup run by ID"),
	)
	.add(
		HttpApiEndpoint.get("downloadRun", "/backups/runs/:id/download", {
			params: { id: BackupRunId },
			success: HttpApiSchema.StreamUint8Array(),
			error: [
				BackupBadRequest.pipe(HttpApiSchema.status(400)),
				BackupConflict.pipe(HttpApiSchema.status(409)),
				BackupNotFound.pipe(HttpApiSchema.status(404)),
				BackupInternalError.pipe(HttpApiSchema.status(500)),
			],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Downloads a completed backup run"),
	)
	.add(
		HttpApiEndpoint.delete("deleteRun", "/backups/runs/:id", {
			params: { id: BackupRunId },
			success: BackupRunIdResponse,
			error: [
				BackupBadRequest.pipe(HttpApiSchema.status(400)),
				BackupConflict.pipe(HttpApiSchema.status(409)),
				BackupNotFound.pipe(HttpApiSchema.status(404)),
				BackupInternalError.pipe(HttpApiSchema.status(500)),
			],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Deletes a backup run by ID"),
	)
	.add(
		HttpApiEndpoint.post("createRestore", "/backups/restores", {
			payload: CreateRestoreBody,
			success: BackupRunIdResponse.pipe(HttpApiSchema.status(201)),
			error: [
				BackupBadRequest.pipe(HttpApiSchema.status(400)),
				BackupConflict.pipe(HttpApiSchema.status(409)),
				BackupInternalError.pipe(HttpApiSchema.status(500)),
			],
		})
			.annotate(DemoAccessPolicy, "protected")
			.annotate(OpenApi.Description, "Starts a backup restore"),
	)
	.middleware(AuthMiddleware);
