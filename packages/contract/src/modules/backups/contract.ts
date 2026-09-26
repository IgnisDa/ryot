import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { BackupRunId } from "../../schema/brands";
import { DownloadUrlResponse } from "../../schema/downloads";
import {
	BackupBadRequest,
	BackupConflict,
	BackupInternalError,
	BackupNotFound,
	BackupRunIdResponse,
	CreateRestoreBody,
} from "./schemas";

export const BackupsGroup = HttpApiGroup.make("backups")
	.annotate(OpenApi.Description, "Manages backup export and restore runs")
	.add(
		AuthenticatedMutationEndpoint.post("protected")("createExport", "/backups/exports", {
			success: BackupRunIdResponse.pipe(HttpApiSchema.status(201)),
			error: [
				BackupConflict.pipe(HttpApiSchema.status(409)),
				BackupBadRequest.pipe(HttpApiSchema.status(400)),
				BackupInternalError.pipe(HttpApiSchema.status(500)),
			],
		}).annotate(OpenApi.Description, "Starts a backup export"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")(
			"createDownloadTicket",
			"/backups/runs/:id/download-url",
			{
				params: { id: BackupRunId },
				success: DownloadUrlResponse,
				error: [
					BackupBadRequest.pipe(HttpApiSchema.status(400)),
					BackupConflict.pipe(HttpApiSchema.status(409)),
					BackupNotFound.pipe(HttpApiSchema.status(404)),
					BackupInternalError.pipe(HttpApiSchema.status(500)),
				],
			},
		).annotate(OpenApi.Description, "Creates a short-lived URL to download a backup run"),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("protected")("deleteRun", "/backups/runs/:id", {
			params: { id: BackupRunId },
			success: BackupRunIdResponse,
			error: [
				BackupBadRequest.pipe(HttpApiSchema.status(400)),
				BackupConflict.pipe(HttpApiSchema.status(409)),
				BackupNotFound.pipe(HttpApiSchema.status(404)),
				BackupInternalError.pipe(HttpApiSchema.status(500)),
			],
		}).annotate(OpenApi.Description, "Deletes a backup run by ID"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("createRestore", "/backups/restores", {
			payload: CreateRestoreBody,
			success: BackupRunIdResponse.pipe(HttpApiSchema.status(201)),
			error: [
				BackupBadRequest.pipe(HttpApiSchema.status(400)),
				BackupConflict.pipe(HttpApiSchema.status(409)),
				BackupInternalError.pipe(HttpApiSchema.status(500)),
			],
		}).annotate(OpenApi.Description, "Starts a backup restore"),
	)
	.middleware(AuthMiddleware);

export const BackupDownloadsGroup = HttpApiGroup.make("backupDownloads")
	.annotate(OpenApi.Description, "Downloads a backup run with a short-lived URL")
	.add(
		HttpApiEndpoint.get("downloadRun", "/backups/runs/:id/download", {
			params: { id: BackupRunId },
			query: { ticket: Schema.NonEmptyString },
			success: HttpApiSchema.StreamUint8Array(),
			error: [
				BackupBadRequest.pipe(HttpApiSchema.status(400)),
				BackupConflict.pipe(HttpApiSchema.status(409)),
				BackupNotFound.pipe(HttpApiSchema.status(404)),
				BackupInternalError.pipe(HttpApiSchema.status(500)),
			],
		}).annotate(OpenApi.Description, "Downloads a backup run with a short-lived URL"),
	);
