import { Schema } from "effect";
import { HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { ImportRunId } from "../../schema/brands";
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
			error: [ImportRequestError.pipe(HttpApiSchema.status(400))],
			success: Schema.Struct({ id: Schema.String }).pipe(HttpApiSchema.status(201)),
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
	.middleware(AuthMiddleware);
