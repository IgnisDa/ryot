import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { BadRequest, NotFound } from "../../errors";
import { ImportRunId } from "../../schema/brands";
import {
	CreateImportRunBody,
	DetailedImportRun,
	GetImportRunParams,
	ListedImportRun,
} from "./schemas";

export const ImportsGroup = HttpApiGroup.make("imports")
	.annotate(OpenApi.Description, "Creates and manages data import runs")
	.add(
		HttpApiEndpoint.post("createRun", "/imports/runs", {
			payload: CreateImportRunBody,
			success: Schema.Struct({ id: Schema.String }).pipe(HttpApiSchema.status(201)),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Creates an import run"),
	)
	.add(
		HttpApiEndpoint.get("listRuns", "/imports/runs", {
			success: Schema.Array(ListedImportRun),
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		}).annotate(OpenApi.Description, "Lists import runs"),
	)
	.add(
		HttpApiEndpoint.get("getRun", "/imports/runs/:runId", {
			params: { runId: ImportRunId },
			query: GetImportRunParams,
			success: DetailedImportRun,
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Gets an import run by ID"),
	)
	.add(
		HttpApiEndpoint.delete("deleteRun", "/imports/runs/:runId", {
			params: { runId: ImportRunId },
			success: Schema.Struct({ id: Schema.String }),
			error: [BadRequest.pipe(HttpApiSchema.status(400)), NotFound.pipe(HttpApiSchema.status(404))],
		}).annotate(OpenApi.Description, "Deletes an import run by ID"),
	)
	.middleware(AuthMiddleware);
