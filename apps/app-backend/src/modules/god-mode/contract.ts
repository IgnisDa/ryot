import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "@effect/platform";
import { Schema } from "effect";

import { AdminMiddleware } from "../../lib/auth";
import { BadRequest, InternalError, NotImplemented, Unauthorized } from "../../lib/errors";

const UserAuthState = Schema.Literal("credential", "oidc", "none", "mixed");

const UserListItem = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	email: Schema.String,
	authState: UserAuthState,
	createdAt: Schema.String,
	bannedAt: Schema.optional(Schema.String),
	twoFactorEnabled: Schema.optional(Schema.Boolean),
});

const ListUsersResponse = Schema.Struct({
	total: Schema.Number,
	users: Schema.Array(UserListItem),
});

const ProvisionUserBody = Schema.Struct({
	email: Schema.String,
	name: Schema.String,
	provider: Schema.Literal("credential", "oidc"),
	oidcIssuerId: Schema.optional(Schema.String),
});

const ProvisionUserResponse = Schema.Struct({ userId: Schema.String });

const ResetPasswordResponse = Schema.Struct({
	email: Schema.String,
	resetUrl: Schema.String,
});

const SetBanBody = Schema.Struct({ banned: Schema.Boolean });

const SetBanResponse = Schema.Struct({
	id: Schema.String,
	bannedAt: Schema.optional(Schema.String),
});

const userIdParam = HttpApiSchema.param("userId", Schema.String);

export const GodModeGroup = HttpApiGroup.make("god-mode")
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
			.addError(Unauthorized, { status: 401 })
			.middleware(AdminMiddleware),
	)
	.add(
		HttpApiEndpoint.post("provisionUser", "/god-mode/users/provision")
			.setPayload(ProvisionUserBody)
			.addSuccess(ProvisionUserResponse, { status: 201 })
			.addError(BadRequest, { status: 400 })
			.addError(InternalError, { status: 500 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AdminMiddleware),
	)
	.add(
		HttpApiEndpoint.post("resetUserPassword")`/god-mode/users/${userIdParam}/reset-password`
			.addSuccess(ResetPasswordResponse)
			.addError(BadRequest, { status: 400 })
			.addError(InternalError, { status: 500 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AdminMiddleware),
	)
	.add(
		HttpApiEndpoint.post("setUserBan")`/god-mode/users/${userIdParam}/ban/set`
			.setPayload(SetBanBody)
			.addSuccess(SetBanResponse)
			.addError(BadRequest, { status: 400 })
			.addError(InternalError, { status: 500 })
			.addError(Unauthorized, { status: 401 })
			.middleware(AdminMiddleware),
	)
	.addError(NotImplemented, { status: 501 });
