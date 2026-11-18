import {
	AccountAdminGroup,
	InstanceAdminInternalFailure,
	InstanceAdminNotFound,
	InstanceAdminRequestFailure,
} from "@ryot-app/instance-contract/account-admin";
import { AdminMiddleware } from "@ryot-app/instance-contract/admin-auth";
import { UserId } from "@ryot-app/instance-contract/user";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiSchema, OpenApi } from "effect/http-api";

import { ImpersonationAuthorization } from "../../oauth";

export const StartUserImpersonationResponse = Schema.Struct({
	ticket: Schema.String,
	expiresAt: Schema.Finite,
});
export type StartUserImpersonationResponse = typeof StartUserImpersonationResponse.Type;

export const UserLifecycleRequestResponse = Schema.Struct({ operationId: Schema.String });

const SetEntitySchemaRefreshIntervalBody = Schema.Struct({
	slug: Schema.NonEmptyString,
	pluginId: Schema.NonEmptyString,
	refreshIntervalDays: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
});

export const InstanceAdminGroup = AccountAdminGroup.add(
	HttpApiEndpoint.post("startUserImpersonation", "/instance-admin/users/:userId/impersonate", {
		params: { userId: UserId },
		payload: ImpersonationAuthorization,
		success: StartUserImpersonationResponse,
		error: [InstanceAdminRequestFailure, InstanceAdminNotFound, InstanceAdminInternalFailure],
	})
		.middleware(AdminMiddleware)
		.annotate(OpenApi.Description, "Starts a user impersonation session"),
)
	.add(
		HttpApiEndpoint.post("resetUser", "/instance-admin/users/:userId/reset", {
			params: { userId: UserId },
			success: UserLifecycleRequestResponse.pipe(HttpApiSchema.status(202)),
			error: [InstanceAdminRequestFailure, InstanceAdminNotFound, InstanceAdminInternalFailure],
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Resets a user account"),
	)
	.add(
		HttpApiEndpoint.put(
			"setEntitySchemaRefreshInterval",
			"/instance-admin/entity-schemas/refresh-interval",
			{ error: [InstanceAdminInternalFailure], payload: SetEntitySchemaRefreshIntervalBody },
		)
			.middleware(AdminMiddleware)
			.annotate(
				OpenApi.Description,
				"Overrides how often an entity schema's entities refresh from their provider, or restores what the plugin declares",
			),
	)
	.add(
		HttpApiEndpoint.delete("deleteUser", "/instance-admin/users/:userId", {
			params: { userId: UserId },
			success: UserLifecycleRequestResponse.pipe(HttpApiSchema.status(202)),
			error: [InstanceAdminRequestFailure, InstanceAdminNotFound, InstanceAdminInternalFailure],
		})
			.middleware(AdminMiddleware)
			.annotate(OpenApi.Description, "Deletes a user account"),
	);
