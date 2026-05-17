import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

const SystemHealthFailureReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("database-unavailable") }),
	Schema.Struct({ code: Schema.Literal("redis-unavailable") }),
]);

export class SystemHealthFailure extends Schema.TaggedError<SystemHealthFailure>()(
	"SystemHealthFailure",
	{ reason: SystemHealthFailureReason },
) {}

const HealthResponse = Schema.Struct({ status: Schema.Literal("healthy") });

const AuthConfig = Schema.Struct({
	oidcEnabled: Schema.Boolean,
	signupAllowed: Schema.Boolean,
	localAuthDisabled: Schema.Boolean,
	oidcButtonLabel: Schema.optional(Schema.String),
});

const NotificationConfig = Schema.Struct({ smtpEnabled: Schema.Boolean });

const FileStorageConfig = Schema.Struct({
	temporaryUploadProvider: Schema.Literal("local"),
	preferredPermanentUploadProvider: Schema.Literals(["local", "s3"]),
});

export const SystemConfigResponse = Schema.Struct({
	auth: AuthConfig,
	fileStorage: FileStorageConfig,
	notifications: NotificationConfig,
});
export type SystemConfigResponse = typeof SystemConfigResponse.Type;

export const SystemGroup = HttpApiGroup.make("system")
	.annotate(OpenApi.Description, "Provides system health and public configuration.")
	.add(
		HttpApiEndpoint.get("health", "/system/health", {
			success: HealthResponse.pipe(HttpApiSchema.status(200)),
			error: SystemHealthFailure.pipe(HttpApiSchema.status(503)),
		}).annotate(OpenApi.Description, "Checks whether the system is healthy."),
	)
	.add(
		HttpApiEndpoint.get("config", "/system/config", {
			success: SystemConfigResponse.pipe(HttpApiSchema.status(200)),
		}).annotate(OpenApi.Description, "Returns the public system configuration."),
	);
