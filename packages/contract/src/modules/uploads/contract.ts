import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import {
	CompleteUploadResponse,
	DownloadResolutionInput,
	DownloadResolutionResponse,
	UploadIntentInput,
	UploadIntentResponse,
	UploadBadRequest,
	UploadInternalError,
} from "./schemas";

const uploadErrors = [
	UploadBadRequest.pipe(HttpApiSchema.status(400)),
	UploadInternalError.pipe(HttpApiSchema.status(500)),
] as const;

export const UploadsGroup = HttpApiGroup.make("uploads")
	.annotate(OpenApi.Description, "Creates upload and download URLs and accepts temporary files")
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("createIntent", "/uploads/intents", {
			error: uploadErrors,
			payload: UploadIntentInput,
			success: UploadIntentResponse,
		}).annotate(OpenApi.Description, "Creates a provider-neutral upload intent"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")(
			"completeIntent",
			"/uploads/intents/:intentId/complete",
			{ error: uploadErrors, success: CompleteUploadResponse, params: { intentId: Schema.String } },
		).annotate(OpenApi.Description, "Completes an upload intent"),
	)
	.add(
		AuthenticatedMutationEndpoint.post("allowed")("resolveDownloads", "/uploads/downloads", {
			error: uploadErrors,
			payload: DownloadResolutionInput,
			success: DownloadResolutionResponse,
		}).annotate(OpenApi.Description, "Resolves download URLs for stored files"),
	)
	.middleware(AuthMiddleware);

export const LocalUploadsGroup = HttpApiGroup.make("localUploads")
	.annotate(OpenApi.Description, "Serves and accepts signed local file targets")
	.add(
		HttpApiEndpoint.put("put", "/uploads/local/:intentId", {
			error: uploadErrors,
			params: { intentId: Schema.String },
			success: Schema.Void.pipe(HttpApiSchema.status(204)),
		}).annotate(OpenApi.Description, "Uploads bytes to a signed local upload target"),
	)
	.add(
		HttpApiEndpoint.get("download", "/uploads/local/download", {
			error: uploadErrors,
			success: HttpApiSchema.StreamUint8Array(),
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
			error: uploadErrors,
			success: Schema.Void,
			query: {
				key: Schema.String,
				expires: Schema.String,
				signature: Schema.String,
				contentType: Schema.String,
			},
		}).annotate(OpenApi.Description, "Reads metadata for a signed local file"),
	);
