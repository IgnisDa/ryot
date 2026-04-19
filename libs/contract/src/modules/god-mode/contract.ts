import { Schema, Effect, SchemaGetter } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";

import { AdminMiddleware } from "../../auth-middleware";
import { BadRequest, InternalError, NotFound } from "../../errors";
import { UserId } from "../../schema/brands";
import { Email } from "../../schema/utils";

const UserAuthState = Schema.Literals(["credential", "oidc", "none", "mixed"]);

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
	Schema.Struct({
		email: Email,
		name: Schema.String,
		provider: Schema.Literal("credential"),
	}).pipe(
		Schema.annotate({
			identifier: "CredentialProvisionUserBody",
			title: "Credential Provision User",
		}),
	),
	Schema.Struct({
		email: Email,
		name: Schema.String,
		oidcIssuerId: Schema.String,
		provider: Schema.Literal("oidc"),
	}).pipe(Schema.annotate({ identifier: "OidcProvisionUserBody", title: "OIDC Provision User" })),
]);

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

export const GodModeGroup = HttpApiGroup.make("godMode")
	.annotate(OpenApi.Description, "Provides administrative user management operations")
	.add(
		HttpApiEndpoint.get("listUsers", "/god-mode/users", {
			query: {
				search: Schema.optional(Schema.String),
				offset: Schema.NumberFromString.pipe(
					(schema) =>
						Schema.optional(schema).pipe(
							Schema.decodeTo(Schema.toType(schema), {
								decode: SchemaGetter.withDefault(Effect.sync(() => 0)),
								encode: SchemaGetter.required(),
							}),
						),
					Schema.withConstructorDefault(Effect.sync(() => 0)),
				),
				limit: Schema.NumberFromString.pipe(
					(schema) =>
						Schema.optional(schema).pipe(
							Schema.decodeTo(Schema.toType(schema), {
								decode: SchemaGetter.withDefault(Effect.sync(() => 50)),
								encode: SchemaGetter.required(),
							}),
						),
					Schema.withConstructorDefault(Effect.sync(() => 50)),
				),
			},
			success: ListUsersResponse,
			error: [BadRequest.pipe(HttpApiSchema.status(400))],
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Lists users with pagination and optional search"),
	)
	.add(
		HttpApiEndpoint.post("provisionUser", "/god-mode/users/provision", {
			payload: ProvisionUserBody,
			success: ProvisionUserResponse.pipe(HttpApiSchema.status(201)),
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				InternalError.pipe(HttpApiSchema.status(500)),
			],
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Provisions a credential or OIDC user"),
	)
	.add(
		HttpApiEndpoint.post("resetUser", "/god-mode/users/:userId/reset", {
			params: { userId: UserId },
			success: ResetUserResponse,
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				InternalError.pipe(HttpApiSchema.status(500)),
			],
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Resets a user account"),
	)
	.add(
		HttpApiEndpoint.post("resetUserPassword", "/god-mode/users/:userId/reset-password", {
			params: { userId: UserId },
			success: ResetPasswordResponse,
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				InternalError.pipe(HttpApiSchema.status(500)),
			],
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Creates a password reset URL for a user"),
	)
	.add(
		HttpApiEndpoint.post("setUserDisabled", "/god-mode/users/:userId/disable/set", {
			params: { userId: UserId },
			payload: SetDisabledBody,
			success: SetDisabledResponse,
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				InternalError.pipe(HttpApiSchema.status(500)),
			],
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Enables or disables a user account"),
	)
	.add(
		HttpApiEndpoint.delete("deleteUser", "/god-mode/users/:userId", {
			params: { userId: UserId },
			success: DeleteUserResponse,
			error: [
				BadRequest.pipe(HttpApiSchema.status(400)),
				NotFound.pipe(HttpApiSchema.status(404)),
				InternalError.pipe(HttpApiSchema.status(500)),
			],
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Deletes a user account"),
	);
