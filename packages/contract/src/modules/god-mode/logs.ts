import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AdminMiddleware } from "../../auth-middleware";

const ServerLogFile = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	size: Schema.Finite,
	active: Schema.Boolean,
	modifiedAt: Schema.String,
});

const ServerLogsLimit = Schema.Int.pipe(
	Schema.check(Schema.isGreaterThan(0)),
	Schema.check(Schema.isLessThanOrEqualTo(100)),
);

export class ServerLogsNotFound extends Schema.TaggedError<ServerLogsNotFound>()(
	"ServerLogsNotFound",
	{ reason: Schema.Struct({ code: Schema.Literal("log-file-unavailable") }) },
) {}

export class ServerLogsFailure extends Schema.TaggedError<ServerLogsFailure>()(
	"ServerLogsFailure",
	{ reason: Schema.Struct({ code: Schema.Literal("log-read-failed") }) },
) {}

const errors = [
	ServerLogsNotFound.pipe(HttpApiSchema.status(404)),
	ServerLogsFailure.pipe(HttpApiSchema.status(500)),
];

export const ServerLogsGroup = HttpApiGroup.make("serverLogs")
	.annotate(OpenApi.Description, "Provides administrative access to server log files")
	.add(
		HttpApiEndpoint.get("list", "/god-mode/logs/files", {
			error: errors,
			query: { limit: ServerLogsLimit, after: Schema.optional(Schema.NonEmptyString) },
			success: Schema.Struct({
				files: Schema.Array(ServerLogFile),
				pageInfo: Schema.Struct({
					limit: Schema.Int,
					hasMore: Schema.Boolean,
					nextCursor: Schema.NullOr(Schema.String),
				}),
			}),
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Lists available server log files"),
	)
	.add(
		HttpApiEndpoint.get("downloadFile", "/god-mode/logs/files/:id/download", {
			error: errors,
			params: { id: Schema.String },
			success: HttpApiSchema.StreamUint8Array(),
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Downloads one server log file"),
	)
	.add(
		HttpApiEndpoint.get("downloadAll", "/god-mode/logs/download", {
			error: errors,
			success: HttpApiSchema.StreamUint8Array(),
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Downloads all server log files"),
	);
