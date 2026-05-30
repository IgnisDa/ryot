import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AuthMiddleware } from "../../lib/auth";
import { NotFound, NotImplemented, RateLimited, Unauthorized } from "../../lib/errors";

const ImportRunStatus = Schema.Literal("pending", "running", "completed", "failed");

export const ListedImportRun = Schema.Struct({
	id: Schema.String,
	source: Schema.String,
	status: ImportRunStatus,
	progress: Schema.Number,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	failedItems: Schema.Number,
	importedItems: Schema.Number,
	processedItems: Schema.Number,
	inputSummary: Schema.Unknown,
	startedAt: Schema.optional(Schema.String),
	finishedAt: Schema.optional(Schema.String),
	totalItems: Schema.optional(Schema.Number),
	errorSummary: Schema.optional(Schema.String),
});

const ListedImportRunFailure = Schema.Struct({
	id: Schema.String,
	data: Schema.Unknown,
	error: Schema.String,
});

const DetailedImportRun = Schema.Struct({
	id: Schema.String,
	source: Schema.String,
	status: ImportRunStatus,
	progress: Schema.Number,
	createdAt: Schema.String,
	updatedAt: Schema.String,
	failedItems: Schema.Number,
	importedItems: Schema.Number,
	processedItems: Schema.Number,
	inputSummary: Schema.Unknown,
	startedAt: Schema.optional(Schema.String),
	finishedAt: Schema.optional(Schema.String),
	totalItems: Schema.optional(Schema.Number),
	errorSummary: Schema.optional(Schema.String),
	failures: Schema.Struct({
		page: Schema.Number,
		total: Schema.Number,
		limit: Schema.Number,
		items: Schema.Array(ListedImportRunFailure),
	}),
});

// Import source body validated by source field; full source-specific schema defined in Task 26
const CreateImportRunBody = Schema.Struct({ source: Schema.String });

const runIdParam = HttpApiSchema.param("runId", Schema.String);

export const ImportsGroup = HttpApiGroup.make("imports")
	.addError(Unauthorized, { status: 401 })
	.addError(RateLimited, { status: 429 })
	.add(
		HttpApiEndpoint.post("createRun", "/imports/runs")
			.setPayload(CreateImportRunBody)
			.addSuccess(Schema.Struct({ id: Schema.String }), { status: 201 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.get("listRuns", "/imports/runs")
			.addSuccess(Schema.Array(ListedImportRun))
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.get("getRun")`/imports/runs/${runIdParam}`
			.setUrlParams(
				Schema.Struct({
					page: Schema.optionalWith(Schema.NumberFromString, { default: () => 1 }),
					limit: Schema.optionalWith(Schema.NumberFromString, { default: () => 20 }),
				}),
			)
			.addSuccess(DetailedImportRun)
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.add(
		HttpApiEndpoint.del("deleteRun")`/imports/runs/${runIdParam}`
			.addSuccess(Schema.Struct({ id: Schema.String }))
			.addError(NotFound, { status: 404 })
			.middleware(AuthMiddleware),
	)
	.addError(NotImplemented, { status: 501 });
