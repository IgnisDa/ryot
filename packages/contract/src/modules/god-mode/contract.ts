import { Schema, Effect, SchemaGetter } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AdminMiddleware } from "../../auth-middleware";
import { UserId } from "../../schema/brands";
import { Email } from "../../schema/utils";
import {
	MigrationReportAnomalyCode,
	MigrationReportDetail,
	MigrationReportLevel,
} from "./migration-report";
import { UserLifecycleOperation } from "./user-lifecycle";

const UserAuthState = Schema.Literals(["credential", "oidc", "none", "mixed"]);

const GodModeRequestFailureReason = Schema.Union([
	Schema.Struct({ email: Email, code: Schema.Literal("user-already-exists") }),
	Schema.Struct({ code: Schema.Literal("local-auth-disabled") }),
	Schema.Struct({ code: Schema.Literal("password-reset-in-progress") }),
	Schema.Struct({ authState: UserAuthState, code: Schema.Literal("password-reset-unsupported") }),
	Schema.Struct({ code: Schema.Literal("mixed-auth-reset-unsupported") }),
]);
const GodModeNotFoundReason = Schema.Union([
	Schema.Struct({ userId: UserId, code: Schema.Literal("user-not-found") }),
	Schema.Struct({
		operationId: Schema.String,
		code: Schema.Literal("lifecycle-operation-not-found"),
	}),
]);
const GodModeInternalFailureReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("persistence-failed") }),
	Schema.Struct({ code: Schema.Literal("access-revocation-failed") }),
	Schema.Struct({ code: Schema.Literal("lifecycle-dispatch-failed") }),
	Schema.Struct({ code: Schema.Literal("lifecycle-state-conflict") }),
	Schema.Struct({ code: Schema.Literal("password-reset-failed") }),
]);

export class GodModeRequestFailure extends Schema.TaggedError<GodModeRequestFailure>()(
	"GodModeRequestFailure",
	{ reason: GodModeRequestFailureReason },
) {}
export class GodModeNotFound extends Schema.TaggedError<GodModeNotFound>()("GodModeNotFound", {
	reason: GodModeNotFoundReason,
}) {}
export class GodModeInternalFailure extends Schema.TaggedError<GodModeInternalFailure>()(
	"GodModeInternalFailure",
	{ reason: GodModeInternalFailureReason },
) {}

const requestFailure = GodModeRequestFailure.pipe(HttpApiSchema.status(400));
const notFoundFailure = GodModeNotFound.pipe(HttpApiSchema.status(404));
const internalFailure = GodModeInternalFailure.pipe(HttpApiSchema.status(500));

const MigrationReportEntry = Schema.Struct({
	seq: Schema.Number,
	phase: Schema.String,
	message: Schema.String,
	createdAt: Schema.String,
	level: MigrationReportLevel,
	count: Schema.NullOr(Schema.Number),
	totalDetails: Schema.NullOr(Schema.Number),
	elapsedSeconds: Schema.NullOr(Schema.Number),
	details: Schema.Array(MigrationReportDetail),
	code: Schema.NullOr(MigrationReportAnomalyCode),
});

const MigrationReportResponse = Schema.Struct({ entries: Schema.Array(MigrationReportEntry) });

const UserListItem = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	email: Schema.String,
	authState: UserAuthState,
	createdAt: Schema.String,
	disabledAt: Schema.NullOr(Schema.String),
	twoFactorEnabled: Schema.NullOr(Schema.Boolean),
});

const ListUsersResponse = Schema.Struct({
	total: Schema.Number,
	users: Schema.Array(UserListItem),
});

const ProvisionUserBody = Schema.Union([
	Schema.Struct({ email: Email, name: Schema.String, provider: Schema.Literal("credential") }).pipe(
		Schema.annotate({
			title: "Credential Provision User",
			identifier: "CredentialProvisionUserBody",
		}),
	),
	Schema.Struct({
		email: Email,
		name: Schema.String,
		oidcIssuerId: Schema.String,
		provider: Schema.Literal("oidc"),
	}).pipe(Schema.annotate({ title: "OIDC Provision User", identifier: "OidcProvisionUserBody" })),
]);

export type ProvisionUserBody = Schema.Schema.Type<typeof ProvisionUserBody>;

const ProvisionUserResponse = Schema.Struct({ userId: UserId });

const ResetPasswordResponse = Schema.Struct({ email: Schema.String, resetUrl: Schema.String });

const SetDisabledBody = Schema.Struct({ disabled: Schema.Boolean });

const SetDisabledResponse = Schema.Struct({
	id: Schema.String,
	disabledAt: Schema.NullOr(Schema.String),
});

export const GodModeGroup = HttpApiGroup.make("godMode")
	.annotate(
		OpenApi.Description,
		"Provides administrative management and migration reporting operations",
	)
	.add(
		HttpApiEndpoint.get("getMigrationReport", "/god-mode/migration-report", {
			error: internalFailure,
			success: MigrationReportResponse,
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Gets the legacy migration report by severity and time"),
	)
	.add(
		HttpApiEndpoint.get("listUsers", "/god-mode/users", {
			error: internalFailure,
			success: ListUsersResponse,
			query: {
				search: Schema.optional(Schema.String),
				offset: Schema.NumberFromString.pipe(
					(schema) =>
						Schema.optional(schema).pipe(
							Schema.decodeTo(Schema.toType(schema), {
								encode: SchemaGetter.required(),
								decode: SchemaGetter.withDefault(Effect.sync(() => 0)),
							}),
						),
					Schema.withConstructorDefault(Effect.sync(() => 0)),
				),
				limit: Schema.NumberFromString.pipe(
					(schema) =>
						Schema.optional(schema).pipe(
							Schema.decodeTo(Schema.toType(schema), {
								encode: SchemaGetter.required(),
								decode: SchemaGetter.withDefault(Effect.sync(() => 50)),
							}),
						),
					Schema.withConstructorDefault(Effect.sync(() => 50)),
				),
			},
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Lists users with pagination and optional search"),
	)
	.add(
		HttpApiEndpoint.post("provisionUser", "/god-mode/users/provision", {
			payload: ProvisionUserBody,
			error: [requestFailure, internalFailure],
			success: ProvisionUserResponse.pipe(HttpApiSchema.status(201)),
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Provisions a credential or OIDC user"),
	)
	.add(
		HttpApiEndpoint.post("resetUser", "/god-mode/users/:userId/reset", {
			params: { userId: UserId },
			error: [requestFailure, notFoundFailure, internalFailure],
			success: UserLifecycleOperation.pipe(HttpApiSchema.status(202)),
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Resets a user account"),
	)
	.add(
		HttpApiEndpoint.post("resetUserPassword", "/god-mode/users/:userId/reset-password", {
			params: { userId: UserId },
			success: ResetPasswordResponse,
			error: [requestFailure, notFoundFailure, internalFailure],
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Creates a password reset URL for a user"),
	)
	.add(
		HttpApiEndpoint.post("setUserDisabled", "/god-mode/users/:userId/disable/set", {
			payload: SetDisabledBody,
			params: { userId: UserId },
			success: SetDisabledResponse,
			error: [notFoundFailure, internalFailure],
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Enables or disables a user account"),
	)
	.add(
		HttpApiEndpoint.delete("deleteUser", "/god-mode/users/:userId", {
			params: { userId: UserId },
			error: [requestFailure, notFoundFailure, internalFailure],
			success: UserLifecycleOperation.pipe(HttpApiSchema.status(202)),
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Deletes a user account"),
	)
	.add(
		HttpApiEndpoint.get(
			"getUserLifecycleOperation",
			"/god-mode/user-lifecycle-operations/:operationId",
			{
				success: UserLifecycleOperation,
				params: { operationId: Schema.String },
				error: [notFoundFailure, internalFailure],
			},
		)
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Gets a user lifecycle operation"),
	);
