import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";

import {
	AuthMiddleware,
	AuthRateLimited,
	AuthUnauthorized,
	DemoOperationProtected,
	UserInitializing,
} from "../../auth-middleware";
import { AuthenticatedMutationEndpoint } from "../../authenticated-mutation-endpoint";
import { SubmissionExpired } from "../../errors";
import { PluginPackageSegment, UserId } from "../../schema/brands";
import { JsonValue } from "../../schema/json";
import {
	InspectPluginBody,
	InstallPluginBody,
	PluginConflictError,
	PluginHomeViewSelection,
	PluginInspection,
	PluginInstallationWriteResult,
	PluginInstallResult,
	PluginInvocationError,
	PluginInvokeBody,
	PluginInvokeResult,
	PluginNotFoundError,
	PluginOperationRejected,
	PluginRequestError,
	UpdatePluginInstallationBody,
	UpdatePrivatePluginBody,
} from "./schemas";

export const PLUGIN_CATALOG_CONNECTED_EVENT = "connected";
export const PLUGIN_CATALOG_INVALIDATED_EVENT = "catalog-invalidated";
export const PluginCatalogEventStream = HttpApiSchema.StreamUint8Array({
	contentType: "text/event-stream",
});

export const PluginCatalogInvalidatedMessage = Schema.Struct({ userId: UserId });
export type PluginCatalogInvalidatedMessage = typeof PluginCatalogInvalidatedMessage.Type;

export const decodePluginCatalogInvalidatedMessage = Schema.decodeUnknownResult(
	Schema.fromJsonString(PluginCatalogInvalidatedMessage),
	{ onExcessProperty: "error" },
);
export const encodePluginCatalogInvalidatedMessage = Schema.encodeResult(
	Schema.fromJsonString(PluginCatalogInvalidatedMessage),
	{ onExcessProperty: "error" },
);

export const PluginsGroup = HttpApiGroup.make("plugins")
	.annotate(OpenApi.Description, "Manages installed plugins for this instance.")
	.add(
		HttpApiEndpoint.get("events", "/plugins/events", {
			success: PluginCatalogEventStream,
		}).annotate(OpenApi.Description, "Streams plugin catalog events for the caller."),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("inspect", "/plugins/inspect", {
			success: PluginInspection,
			payload: InspectPluginBody,
			error: [
				PluginRequestError.pipe(HttpApiSchema.status(400)),
				PluginNotFoundError.pipe(HttpApiSchema.status(404)),
				PluginConflictError.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(
			OpenApi.Description,
			"Validates an uploaded plugin archive as an install candidate, or as an update of the given private installation, and returns its manifest summary without installing it or consuming the upload.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.post("protected")("install", "/plugins", {
			payload: InstallPluginBody,
			success: PluginInstallResult.pipe(HttpApiSchema.status(201)),
			error: [
				PluginRequestError.pipe(HttpApiSchema.status(400)),
				PluginConflictError.pipe(HttpApiSchema.status(409)),
			],
		}).annotate(
			OpenApi.Description,
			"Validates a precompiled plugin archive and installs it privately with initial configuration.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.put("protected")(
			"update",
			"/plugins/installations/:installationId/package",
			{
				payload: UpdatePrivatePluginBody,
				success: PluginInstallationWriteResult,
				params: { installationId: Schema.String },
				error: [
					PluginRequestError.pipe(HttpApiSchema.status(400)),
					PluginNotFoundError.pipe(HttpApiSchema.status(404)),
					PluginConflictError.pipe(HttpApiSchema.status(409)),
				],
			},
		).annotate(
			OpenApi.Description,
			"Validates a precompiled archive and atomically updates the selected private plugin package. A supplied config replaces the stored one; omitted secrets keep their stored values.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("protected")(
			"uninstall",
			"/plugins/installations/:installationId/:activationId",
			{
				success: PluginInstallationWriteResult,
				params: { activationId: Schema.String, installationId: Schema.String },
				error: [
					PluginConflictError.pipe(HttpApiSchema.status(409)),
					PluginNotFoundError.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(
			OpenApi.Description,
			"Uninstalls the caller's private plugin unless a workflow or persistent resource still references it.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.patch("protected")(
			"updatePluginState",
			"/plugins/installations/:installationId/state",
			{
				payload: UpdatePluginInstallationBody,
				success: PluginInstallationWriteResult,
				params: { installationId: Schema.String },
				error: [
					PluginRequestError.pipe(HttpApiSchema.status(400)),
					PluginNotFoundError.pipe(HttpApiSchema.status(404)),
					PluginConflictError.pipe(HttpApiSchema.status(409)),
				],
			},
		).annotate(
			OpenApi.Description,
			"Update the caller's plugin installation. A supplied config replaces the stored one; omitted secrets keep their stored values.",
		),
	)
	.add(
		AuthenticatedMutationEndpoint.put("protected")(
			"setHomeView",
			"/plugins/installations/:installationId/home-view",
			{
				payload: PluginHomeViewSelection,
				success: PluginHomeViewSelection,
				params: { installationId: Schema.String },
				error: [
					PluginRequestError.pipe(HttpApiSchema.status(400)),
					PluginNotFoundError.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(OpenApi.Description, "Sets or clears the caller's plugin home saved view."),
	)
	.add(
		AuthenticatedMutationEndpoint.put("protected")(
			"saveUserSettings",
			"/plugins/installations/:installationId/user-settings",
			{
				params: { installationId: Schema.String },
				payload: Schema.Record(Schema.String, JsonValue),
				success: Schema.Void.pipe(HttpApiSchema.status(204)),
				error: [
					PluginRequestError.pipe(HttpApiSchema.status(400)),
					PluginNotFoundError.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(OpenApi.Description, "Saves the caller's settings for a plugin installation."),
	)
	.add(
		AuthenticatedMutationEndpoint.delete("protected")(
			"resetUserSettings",
			"/plugins/installations/:installationId/user-settings",
			{
				params: { installationId: Schema.String },
				success: Schema.Void.pipe(HttpApiSchema.status(204)),
				error: [
					PluginRequestError.pipe(HttpApiSchema.status(400)),
					PluginNotFoundError.pipe(HttpApiSchema.status(404)),
				],
			},
		).annotate(
			OpenApi.Description,
			"Resets the caller's settings for a plugin installation to defaults.",
		),
	)
	.middleware(AuthMiddleware)
	.add(
		// Operation manifests enforce their own demo access when invoked.
		AuthenticatedMutationEndpoint.post("allowed")(
			"invoke",
			"/plugins/:publisher/:name/operations/:operationSlug",
			{
				payload: PluginInvokeBody,
				success: PluginInvokeResult,
				params: {
					name: PluginPackageSegment,
					operationSlug: Schema.String,
					publisher: PluginPackageSegment,
				},
				error: [
					AuthUnauthorized.pipe(HttpApiSchema.status(401)),
					DemoOperationProtected.pipe(HttpApiSchema.status(403)),
					PluginConflictError.pipe(HttpApiSchema.status(409)),
					PluginNotFoundError.pipe(HttpApiSchema.status(404)),
					PluginRequestError.pipe(HttpApiSchema.status(400)),
					SubmissionExpired.pipe(HttpApiSchema.status(410)),
					AuthRateLimited.pipe(HttpApiSchema.status(429)),
					UserInitializing.pipe(HttpApiSchema.status(503)),
					PluginOperationRejected.pipe(HttpApiSchema.status(422)),
					PluginInvocationError.pipe(HttpApiSchema.status(502)),
				],
			},
		).annotate(
			OpenApi.Description,
			"Invokes a named plugin operation as a synchronous sandbox execution, enforcing the operation's declared authentication mode. An optional idempotency key reuses the same execution for retries with immutable input.",
		),
	);
