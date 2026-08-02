import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AuthMiddleware } from "../../auth-middleware";
import { DemoAccessPolicy } from "../../http-annotations";
import { ImportRunId } from "../../schema/brands";
import {
	CreateImportRunBody,
	ImportNotFoundError,
	ImportRequestError,
	ListedImportSource,
} from "./schemas";

export const ImportsGroup = HttpApiGroup.make("imports")
	.annotate(OpenApi.Description, "Creates and manages data import runs")
	.add(
		HttpApiEndpoint.get("listSources", "/imports/sources", {
			success: Schema.Array(ListedImportSource),
		}).annotate(OpenApi.Description, "Lists available import sources"),
	)
	.add(
		HttpApiEndpoint.post("createRun", "/imports/runs", {
			payload: CreateImportRunBody,
			error: [ImportRequestError.pipe(HttpApiSchema.status(400))],
			success: Schema.Struct({ id: Schema.String }).pipe(HttpApiSchema.status(201)),
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Creates an import run"),
	)
	.add(
		HttpApiEndpoint.delete("deleteRun", "/imports/runs/:runId", {
			params: { runId: ImportRunId },
			success: Schema.Struct({ id: Schema.String }),
			error: [
				ImportRequestError.pipe(HttpApiSchema.status(400)),
				ImportNotFoundError.pipe(HttpApiSchema.status(404)),
			],
		})
			.annotate(DemoAccessPolicy, "allowed")
			.annotate(OpenApi.Description, "Deletes an import run by ID"),
	)
	.middleware(AuthMiddleware);
