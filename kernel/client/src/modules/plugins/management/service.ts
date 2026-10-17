import {
	PluginConflictError,
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { createRyotMutation, createRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	pluginInstallationsRecipe,
	type PluginInstallationsPage,
} from "@ryot-app/ryotql-recipes/plugin-installations";
import { Context, Data, Effect, Layer, Schema } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { loadAllPages } from "#/api/load-all-pages";
import { PluginInstallationsApi } from "#/api/plugin-installations";
import type { KernelRyotClient } from "#/api/ryot-client";
import type { ApiScope } from "#/api/scope";
import type { KernelHostServices } from "#/host-services";
import { Uploads } from "#/modules/assets/uploads";

export type ManagedPluginInstallation = PluginInstallationsPage["items"][number];

export type PluginManagementAction =
	| {
			readonly kind: "state";
			readonly installation: ManagedPluginInstallation;
			readonly isHidden: boolean;
	  }
	| {
			readonly kind: "configure";
			readonly installation: ManagedPluginInstallation;
			readonly config: string;
			readonly unsetKeys: string;
	  }
	| {
			readonly kind: "package";
			readonly installation: ManagedPluginInstallation;
			readonly file: File;
	  }
	| { readonly kind: "uninstall"; readonly installation: ManagedPluginInstallation };

export class PluginManagementError extends Data.TaggedError("PluginManagementError")<{
	readonly detail: string;
}> {}

const DeclaredPluginFailure = Schema.Union([
	PluginConflictError,
	PluginNotFoundError,
	PluginRequestError,
]);

const failureDetails: Record<(typeof DeclaredPluginFailure.Type)["reason"]["code"], string> = {
	"plugin-not-found": "This plugin no longer exists.",
	"validation-failed": "The plugin failed validation.",
	"home-view-hidden": "The plugin's home view is hidden.",
	"already-installed": "This package is already installed.",
	"package-archive-invalid": "The plugin archive is invalid.",
	"compilation-failed": "The plugin archive failed to compile.",
	"operation-not-found": "The plugin operation does not exist.",
	"workflow-referenced": "Your workflows still use this plugin.",
	"home-view-not-found": "The plugin's home view does not exist.",
	"installation-not-found": "This installation no longer exists.",
	"saved-view-referenced": "Your saved views still use this plugin.",
	"integration-referenced": "Your integrations still use this plugin.",
	"asset-forbidden": "A file in these settings is not available to you.",
	"operation-scope-not-found": "The plugin operation scope does not exist.",
	"installation-not-ready": "This installation is not ready for that change.",
	"system-plugin": "System plugins are managed by deployment administrators.",
	"entity-referenced": "Your library still has entities that use this plugin.",
	"home-view-renderer-unavailable": "The plugin's home view renderer is unavailable.",
	"package-id-mismatch": "The archive's package ID does not match this installation.",
	"reserved-system-identity": "This package identity is reserved for system plugins.",
	"invalid-operation-scope": "The plugin declares an operation with an invalid scope.",
	"definition-referenced": "Your data still uses definitions this plugin would remove.",
	"upload-unavailable": "The uploaded archive is no longer available. Upload it again.",
	"schema-evolution-failed": "The update cannot migrate this plugin's existing schemas.",
	"package-identity-conflict": "Another installation already uses this package identity.",
	"unsupported-manifest-surface": "The plugin uses features this server does not support.",
	"source-revision-stale": "This installation changed since it was loaded. Refresh and try again.",
	"referenced-definition-incompatible":
		"The update is incompatible with definitions your data uses.",
};

const commandFailure = (cause: unknown) =>
	new PluginManagementError({
		detail:
			cause instanceof AuthenticatedApiError && Schema.is(DeclaredPluginFailure)(cause.cause)
				? failureDetails[cause.cause.reason.code]
				: "The plugin command failed.",
	});

export const errorDetail = (error: Error | null) =>
	error instanceof PluginManagementError ? error.detail : error?.message;

export class PluginManagementService extends Context.Service<PluginManagementService>()(
	"PluginManagementService",
	{
		make: Effect.gen(function* () {
			const api = yield* PluginInstallationsApi;
			const uploads = yield* Uploads;
			const load = Effect.fn("PluginManagement.load")(function* (
				client: Pick<KernelRyotClient, "data">,
			) {
				return yield* loadAllPages((after) =>
					client.data.query(pluginInstallationsRecipe({ after, limit: 100 })),
				).pipe(
					Effect.mapError(
						() => new PluginManagementError({ detail: "Could not load plugin installations." }),
					),
				);
			});
			const execute = Effect.fn("PluginManagement.execute")(function* (
				scope: ApiScope,
				action: PluginManagementAction,
			) {
				const installation = action.installation;
				const params = { installationId: installation.installationId };
				if (action.kind === "state") {
					return yield* api
						.update(scope, { params, payload: { isHidden: action.isHidden } })
						.pipe(Effect.mapError(commandFailure));
				}
				if (action.kind === "configure") {
					const config = yield* Schema.decodeEffect(
						Schema.fromJsonString(Schema.Record(Schema.String, JsonValue)),
					)(action.config).pipe(
						Effect.mapError(
							() => new PluginManagementError({ detail: "Configuration must be a JSON object." }),
						),
					);
					const unsetConfigKeys = action.unsetKeys
						.split(",")
						.map((key) => key.trim())
						.filter(Boolean);
					return yield* api
						.update(scope, { params, payload: { config, unsetConfigKeys } })
						.pipe(Effect.mapError(commandFailure));
				}
				if (action.kind === "package") {
					const upload = yield* uploads
						.upload(scope, {
							action: "temporary",
							source: action.file,
							fileName: action.file.name,
							contentType: action.file.type || "application/zip",
						})
						.pipe(
							Effect.mapError(
								() =>
									new PluginManagementError({
										detail: "Could not upload the selected plugin archive.",
									}),
							),
						);
					if (upload.action !== "temporary") {
						return yield* new PluginManagementError({
							detail: "Could not upload the selected plugin archive.",
						});
					}
					return yield* api
						.updatePackage(scope, {
							params,
							payload: { uploadToken: upload.token.token, contentHash: installation.contentHash },
						})
						.pipe(Effect.mapError(commandFailure));
				}
				return yield* api
					.uninstall(scope, { params: { ...params, activationId: installation.activationId } })
					.pipe(Effect.mapError(commandFailure));
			});
			return { load, execute };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const PluginManagementLive = PluginManagementService.layer.pipe(
	Layer.provide(Layer.mergeAll(PluginInstallationsApi.layer, Uploads.layer)),
);

export const pluginManagementQuery = createRyotQuery<
	void,
	readonly ManagedPluginInstallation[],
	KernelHostServices,
	PluginManagementError
>(({ client, hostServices }) => hostServices.runtime.runSync(PluginManagementService).load(client));
export const pluginManagementMutation = createRyotMutation<
	PluginManagementAction,
	Effect.Success<ReturnType<PluginManagementService["Service"]["execute"]>>,
	KernelHostServices,
	PluginManagementError
>(({ input, hostServices }) =>
	hostServices.runtime.runSync(PluginManagementService).execute(hostServices.scope, input),
);
