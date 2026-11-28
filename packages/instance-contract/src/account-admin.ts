import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import { AdminMiddleware } from "./admin-auth";
import { Email, UserId } from "./user";

const UserAuthState = Schema.Literals(["credential", "oidc", "none", "mixed"]);

const InstanceAdminRequestFailureReason = Schema.Union([
	Schema.Struct({ email: Email, code: Schema.Literal("user-already-exists") }),
	Schema.Struct({ code: Schema.Literal("user-disabled") }),
	Schema.Struct({ code: Schema.Literal("user-initializing") }),
	Schema.Struct({ code: Schema.Literal("user-unavailable") }),
	Schema.Struct({ code: Schema.Literal("invalid-impersonation-authorization") }),
	Schema.Struct({ code: Schema.Literal("local-auth-disabled") }),
	Schema.Struct({ code: Schema.Literal("password-reset-in-progress") }),
	Schema.Struct({ authState: UserAuthState, code: Schema.Literal("password-reset-unsupported") }),
	Schema.Struct({ code: Schema.Literal("mixed-auth-reset-unsupported") }),
]);
const InstanceAdminNotFoundReason = Schema.Struct({
	userId: UserId,
	code: Schema.Literal("user-not-found"),
});
const InstanceAdminInternalFailureReason = Schema.Union([
	Schema.Struct({ code: Schema.Literal("persistence-failed") }),
	Schema.Struct({ code: Schema.Literal("lifecycle-dispatch-failed") }),
	Schema.Struct({ code: Schema.Literal("lifecycle-state-conflict") }),
	Schema.Struct({ code: Schema.Literal("password-reset-failed") }),
	Schema.Struct({ code: Schema.Literal("impersonation-unavailable") }),
]);

export class InstanceAdminNotFound extends Schema.TaggedError<
	InstanceAdminNotFound,
	{ readonly brand: unique symbol }
>()("InstanceAdminNotFound", { reason: InstanceAdminNotFoundReason }, { httpApiStatus: 404 }) {}
export class InstanceAdminRequestFailure extends Schema.TaggedError<
	InstanceAdminRequestFailure,
	{ readonly brand: unique symbol }
>()(
	"InstanceAdminRequestFailure",
	{ reason: InstanceAdminRequestFailureReason },
	{ httpApiStatus: 400 },
) {}
export class InstanceAdminInternalFailure extends Schema.TaggedError<
	InstanceAdminInternalFailure,
	{ readonly brand: unique symbol }
>()(
	"InstanceAdminInternalFailure",
	{ reason: InstanceAdminInternalFailureReason },
	{ httpApiStatus: 500 },
) {}

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

const SetDisabledResponse = Schema.Struct({ id: UserId });

export const AccountAdminGroup = HttpApiGroup.make("instanceAdmin")
	.annotate(OpenApi.Description, "Provides administrative management operations")
	.add(
		HttpApiEndpoint.post("provisionUser", "/instance-admin/users/provision", {
			payload: ProvisionUserBody,
			success: ProvisionUserResponse.pipe(HttpApiSchema.status(201)),
			error: [InstanceAdminRequestFailure, InstanceAdminInternalFailure],
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Provisions a credential or OIDC user"),
	)
	.add(
		HttpApiEndpoint.post("resetUserPassword", "/instance-admin/users/:userId/reset-password", {
			params: { userId: UserId },
			success: ResetPasswordResponse,
			error: [InstanceAdminRequestFailure, InstanceAdminNotFound, InstanceAdminInternalFailure],
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Creates a password reset URL for a user"),
	)
	.add(
		HttpApiEndpoint.post("setUserDisabled", "/instance-admin/users/:userId/disable/set", {
			payload: SetDisabledBody,
			params: { userId: UserId },
			success: SetDisabledResponse,
			error: [InstanceAdminNotFound, InstanceAdminInternalFailure],
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Enables or disables a user account"),
	);
