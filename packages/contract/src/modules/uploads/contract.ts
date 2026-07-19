import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest } from "../../errors";
import {
	CompleteUploadResponse,
	DownloadResolutionInput,
	DownloadResolutionResponse,
	UploadIntentInput,
	UploadIntentResponse,
} from "./schemas";

export const UploadsGroup = HttpApiGroup.make("uploads")
	.annotate(OpenApi.Description, "Creates upload and download URLs and accepts temporary files")
	.add(
		HttpApiEndpoint.post("createIntent", "/uploads/intents", {
			payload: UploadIntentInput,
			success: UploadIntentResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Creates a provider-neutral upload intent"),
	)
	.add(
		HttpApiEndpoint.post("completeIntent", "/uploads/intents/:intentId/complete", {
			success: CompleteUploadResponse,
			params: { intentId: Schema.String },
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Completes an upload intent"),
	)
	.add(
		HttpApiEndpoint.post("resolveDownloads", "/uploads/downloads", {
			payload: DownloadResolutionInput,
			success: DownloadResolutionResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Resolves download URLs for stored files"),
	)
	.middleware(AuthMiddleware);

export const LocalUploadsGroup = HttpApiGroup.make("localUploads")
	.annotate(OpenApi.Description, "Serves and accepts signed local file targets")
	.add(
		HttpApiEndpoint.put("put", "/uploads/local/:intentId", {
			params: { intentId: Schema.String },
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
			success: Schema.Void.pipe(HttpApiSchema.status(204)),
		}).annotate(OpenApi.Description, "Uploads bytes to a signed local upload target"),
	)
	.add(
		HttpApiEndpoint.get("download", "/uploads/local/download", {
			success: HttpApiSchema.StreamUint8Array(),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
			query: {
				key: Schema.String,
				expires: Schema.String,
				signature: Schema.String,
				contentType: Schema.String,
			},
		}).annotate(OpenApi.Description, "Downloads a signed local file"),
	)
	.add(
		HttpApiEndpoint.head("downloadHead", "/uploads/local/download", {
			success: Schema.Void,
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
			query: {
				key: Schema.String,
				expires: Schema.String,
				signature: Schema.String,
				contentType: Schema.String,
			},
		}).annotate(OpenApi.Description, "Reads metadata for a signed local file"),
	);
