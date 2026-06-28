import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AdminMiddleware } from "../../auth-middleware";
import { InternalError, NotFound, Unauthorized } from "../../errors";
import { UserId } from "../../schema/brands";
import { Email } from "../../schema/utils";

const UserAuthState = Schema.Literal("credential", "oidc", "none", "mixed");

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

const ProvisionUserBody = Schema.Union(
	Schema.Struct({
		email: Email,
		name: Schema.String,
		provider: Schema.Literal("credential"),
	}).pipe(
		Schema.annotations({
			identifier: "CredentialProvisionUserBody",
			title: "Credential Provision User",
		}),
	),
	Schema.Struct({
		email: Email,
		name: Schema.String,
		oidcIssuerId: Schema.String,
		provider: Schema.Literal("oidc"),
	}).pipe(
		Schema.annotations({ identifier: "OidcProvisionUserBody", title: "OIDC Provision User" }),
	),
);

export type ProvisionUserBody = Schema.Schema.Type<typeof ProvisionUserBody>;

const ProvisionUserResponse = Schema.Struct({ userId: UserId });

const ResetUserResponse = Schema.Struct({
	userId: UserId,
	email: Schema.String,
	resetUrl: Schema.NullOr(Schema.String),
});

const ResetPasswordResponse = Schema.Struct({
	email: Schema.String,
	resetUrl: Schema.String,
});

const SetDisabledBody = Schema.Struct({ disabled: Schema.Boolean });

const SetDisabledResponse = Schema.Struct({
	id: Schema.String,
	disabledAt: Schema.NullOr(Schema.String),
});

const DeleteUserResponse = Schema.Struct({ id: UserId });

const userIdParam = HttpApiSchema.param("userId", UserId);

export const GodModeGroup = HttpApiGroup.make("godMode")
	.addError(Unauthorized, { status: 401 })
	.add(
		HttpApiEndpoint.get("listUsers", "/god-mode/users")
			.setUrlParams(
				Schema.Struct({
					search: Schema.optional(Schema.String),
					offset: Schema.optionalWith(Schema.NumberFromString, { default: () => 0 }),
					limit: Schema.optionalWith(Schema.NumberFromString, { default: () => 50 }),
				}),
			)
			.addSuccess(ListUsersResponse)
			.middleware(AdminMiddleware),
	)
	.add(
		HttpApiEndpoint.post("provisionUser", "/god-mode/users/provision")
			.setPayload(ProvisionUserBody)
			.addSuccess(ProvisionUserResponse, { status: 201 })
			.addError(InternalError, { status: 500 })
			.middleware(AdminMiddleware),
	)
	.add(
		HttpApiEndpoint.post("resetUser")`/god-mode/users/${userIdParam}/reset`
			.addSuccess(ResetUserResponse)
			.addError(InternalError, { status: 500 })
			.middleware(AdminMiddleware),
	)
	.add(
		HttpApiEndpoint.post("resetUserPassword")`/god-mode/users/${userIdParam}/reset-password`
			.addSuccess(ResetPasswordResponse)
			.addError(InternalError, { status: 500 })
			.middleware(AdminMiddleware),
	)
	.add(
		HttpApiEndpoint.post("setUserDisabled")`/god-mode/users/${userIdParam}/disable/set`
			.setPayload(SetDisabledBody)
			.addSuccess(SetDisabledResponse)
			.addError(InternalError, { status: 500 })
			.middleware(AdminMiddleware),
	)
	.add(
		HttpApiEndpoint.del("deleteUser")`/god-mode/users/${userIdParam}`
			.addSuccess(DeleteUserResponse)
			.addError(NotFound, { status: 404 })
			.addError(InternalError, { status: 500 })
			.middleware(AdminMiddleware),
	);
