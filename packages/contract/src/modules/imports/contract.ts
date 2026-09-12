import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { ImportRunId } from "../../schema/brands";
import { DownloadUrlResponse } from "../../schema/downloads";
import {
	CreateImportRunBody,
	ImportConflictError,
	ImportNotFoundError,
	ImportRequestError,
} from "./schemas";

export const ImportsGroup = HttpApiGroup.make("imports")
	.annotate(OpenApi.Description, "Creates and manages data import runs")
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("createRun", "/imports/runs", {
			payload: CreateImportRunBody,
			success: Schema.Struct({ id: Schema.String }).pipe(HttpApiSchema.status(201)),
			error: [
				ImportRequestError.pipe(HttpApiSchema.status(400)),
				ImportConflictError.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(OpenApi.Description, "Creates an import run"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("cancelRun", "/imports/runs/:runId/cancel", {
			params: { runId: ImportRunId },
			success: Schema.Struct({ id: ImportRunId }).pipe(HttpApiSchema.status(202)),
			error: [
				ImportNotFoundError.pipe(HttpApiSchema.status(404)),
				ImportConflictError.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(OpenApi.Description, "Cancels an import run by ID"),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("allowed")("deleteRun", "/imports/runs/:runId", {
			params: { runId: ImportRunId },
			success: Schema.Struct({ id: Schema.String }),
			error: [
				ImportConflictError.pipe(HttpApiSchema.status(409)),
				ImportNotFoundError.pipe(HttpApiSchema.status(404)),
			],
		}).annotate(OpenApi.Description, "Deletes an import run by ID"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")(
			"createFailuresDownloadTicket",
			"/imports/runs/:runId/failures/download-url",
			{
				success: DownloadUrlResponse,
				params: { runId: ImportRunId },
				error: [ImportNotFoundError.pipe(HttpApiSchema.status(404))],
			},
		).annotate(OpenApi.Description, "Creates a short-lived URL to download import failures"),
	)
	.middleware(AuthMiddleware);

export const ImportDownloadsGroup = HttpApiGroup.make("importDownloads")
	.annotate(OpenApi.Description, "Downloads import failures with a short-lived URL")
	.add(
		HttpApiEndpoint.get("downloadFailures", "/imports/runs/:runId/failures/download", {
			params: { runId: ImportRunId },
			query: { ticket: Schema.NonEmptyString },
			success: HttpApiSchema.StreamUint8Array(),
			error: [ImportNotFoundError.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Downloads import failures with a short-lived URL"),
	);
