import {
	PluginConflictError,
	type PluginInspection,
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { createRyotHostMutation, createRyotHostQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	type PluginInstallationsPage,
	pluginInstallationsRecipe,
} from "@ryot-app/ryotql-recipes/plugin-installations";
import { Context, Effect, Layer, Schema } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { loadAllPages } from "#/api/load-all-pages";
import { PluginInstallationsApi } from "#/api/plugin-installations";
import type { KernelRyotClient } from "#/api/ryot-client";
import type { ApiScope } from "#/api/scope";
import { KernelHostServices } from "#/host-services";

export type ManagedPluginInstallation = PluginInstallationsPage["items"][number];

export type PluginArchiveSubmission = {
	readonly uploadToken: string;
	readonly config: PluginConfig;
};

export type PluginManagementAction =
	| (PluginArchiveSubmission & { readonly kind: "install" })
	| { readonly kind: "uninstall"; readonly installation: ManagedPluginInstallation }
	| (PluginArchiveSubmission & {
			readonly kind: "package";
			readonly installation: ManagedPluginInstallation;
	  })
	| {
			readonly kind: "state";
			readonly isHidden: boolean;
			readonly installation: ManagedPluginInstallation;
	  }
	| {
			readonly kind: "configure";
			readonly config: PluginConfig;
			readonly installation: ManagedPluginInstallation;
	  };

type PluginConfig = Readonly<Record<string, JsonValue>>;

type PluginArchiveInspectionRequest = {
	readonly uploadToken: string;
	readonly installation?: undefined | ManagedPluginInstallation;
};

export class PluginManagementError extends Schema.TaggedError<
	PluginManagementError,
	{ readonly brand: unique symbol }
>()("PluginManagementError", { detail: Schema.String }) {}

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
	"page-write-access-required": "Page write access is required.",
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

export const errorDetail = (error: null | Error) =>
	error instanceof PluginManagementError ? error.detail : error?.message;

export class PluginManagementService extends Context.Service<PluginManagementService>()(
	"@ryot-app/kernel-client/modules/plugins/management/service/PluginManagementService",
	{
		make: Effect.gen(function* () {
			const api = yield* PluginInstallationsApi;
			const load = Effect.fn("PluginManagement.load")(function* (
				client: Pick<KernelRyotClient, "data">,
			) {
				return yield* loadAllPages((after) =>
					client.data.query(
						pluginInstallationsRecipe,
						{},
						{ pages: { installations: { after, limit: 100 } } },
					),
				).pipe(
					Effect.mapError(
						() => new PluginManagementError({ detail: "Could not load plugin installations." }),
					),
				);
			});
			const inspect = Effect.fn("PluginManagement.inspect")(
				(scope: ApiScope, request: PluginArchiveInspectionRequest) =>
					api
						.inspect(scope, {
							payload: {
								uploadToken: request.uploadToken,
								...(request.installation === undefined
									? {}
									: { installationId: request.installation.installationId }),
							},
						})
						.pipe(Effect.mapError(commandFailure)),
			);
			const run = (scope: ApiScope, action: PluginManagementAction) => {
				if (action.kind === "install") {
					return api.install(scope, {
						payload: { config: action.config, uploadToken: action.uploadToken },
					});
				}
				const installation = action.installation;
				const params = { installationId: installation.installationId };
				if (action.kind === "state") {
					return api.update(scope, { params, payload: { isHidden: action.isHidden } });
				}
				if (action.kind === "configure") {
					return api.update(scope, { params, payload: { config: action.config } });
				}
				if (action.kind === "package") {
					return api.updatePackage(scope, {
						params,
						payload: {
							config: action.config,
							uploadToken: action.uploadToken,
							contentHash: installation.contentHash,
						},
					});
				}
				return api.uninstall(scope, {
					params: { ...params, activationId: installation.activationId },
				});
			};
			const execute = Effect.fn("PluginManagement.execute")(
				(scope: ApiScope, action: PluginManagementAction) =>
					run(scope, action).pipe(Effect.mapError(commandFailure)),
			);
			return { load, inspect, execute };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}

export const PluginManagementLive = PluginManagementService.layer.pipe(
	Layer.provide(PluginInstallationsApi.layer),
);

export const pluginManagementQuery = createRyotHostQuery<
	void,
	readonly ManagedPluginInstallation[],
	KernelHostServices,
	PluginManagementError
>(
	({ client, hostServices }) => hostServices.runtime.runSync(PluginManagementService).load(client),
	{ hostServices: KernelHostServices },
);
export const pluginManagementMutation = createRyotHostMutation<
	PluginManagementAction,
	Effect.Success<ReturnType<PluginManagementService["Service"]["execute"]>>,
	KernelHostServices,
	PluginManagementError
>(
	({ input, hostServices }) =>
		hostServices.runtime.runSync(PluginManagementService).execute(hostServices.scope, input),
	{ hostServices: KernelHostServices },
);
export const pluginArchiveInspectionMutation = createRyotHostMutation<
	PluginArchiveInspectionRequest,
	PluginInspection,
	KernelHostServices,
	PluginManagementError
>(
	({ input, hostServices }) =>
		hostServices.runtime.runSync(PluginManagementService).inspect(hostServices.scope, input),
	{ hostServices: KernelHostServices },
);
