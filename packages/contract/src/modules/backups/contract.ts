import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, Conflict, InternalError, NotFound } from "../../errors";
import { BackupRunId } from "../../schema/brands";
import { BackupRun, BackupRunIdResponse, CreateRestoreBody, ListRunsResponse } from "./schemas";

export const BackupsGroup = HttpApiGroup.make("backups")
	.annotate(OpenApi.Description, "Manages backup export and restore runs")
	.add(
		HttpApiEndpoint.post("createExport", "/backups/exports", {
			success: BackupRunIdResponse.pipe(HttpApiSchema.status(201)),
			error: [
				Conflict.pipe(HttpApiSchema.status(409)),
				BadRequest.pipe(HttpApiSchema.status(400)),
				InternalError.pipe(HttpApiSchema.status(500)),
			],
		}).annotate(OpenApi.Description, "Starts a backup export"),
	)
	.add(
		HttpApiEndpoint.get("listRuns", "/backups/runs", {
			success: ListRunsResponse,
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				InternalError.pipe(HttpApiSchema.status(500)),
			],
		}).annotate(OpenApi.Description, "Lists backup runs"),
	)
	.add(
		HttpApiEndpoint.get("getRun", "/backups/runs/:id", {
			success: BackupRun,
			params: { id: BackupRunId },
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				NotFound.pipe(HttpApiSchema.status(404)),
				InternalError.pipe(HttpApiSchema.status(500)),
			],
		}).annotate(OpenApi.Description, "Gets a backup run by ID"),
	)
	.add(
		HttpApiEndpoint.get("downloadRun", "/backups/runs/:id/download", {
			params: { id: BackupRunId },
			success: HttpApiSchema.StreamUint8Array(),
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				Conflict.pipe(HttpApiSchema.status(409)),
				NotFound.pipe(HttpApiSchema.status(404)),
				InternalError.pipe(HttpApiSchema.status(500)),
			],
		}).annotate(OpenApi.Description, "Downloads a completed backup run"),
	)
	.add(
		HttpApiEndpoint.delete("deleteRun", "/backups/runs/:id", {
			params: { id: BackupRunId },
			success: BackupRunIdResponse,
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				Conflict.pipe(HttpApiSchema.status(409)),
				NotFound.pipe(HttpApiSchema.status(404)),
				InternalError.pipe(HttpApiSchema.status(500)),
			],
		}).annotate(OpenApi.Description, "Deletes a backup run by ID"),
	)
	.add(
		HttpApiEndpoint.post("createRestore", "/backups/restores", {
			payload: CreateRestoreBody,
			success: BackupRunIdResponse.pipe(HttpApiSchema.status(201)),
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				Conflict.pipe(HttpApiSchema.status(409)),
				InternalError.pipe(HttpApiSchema.status(500)),
			],
		}).annotate(OpenApi.Description, "Starts a backup restore"),
	)
	.middleware(AuthMiddleware);
