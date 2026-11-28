import {
	PluginConflictError,
	type PluginInspection,
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { Message } from "@ryot-app/i18n/message";
import type { Text } from "@ryot-app/i18n/text";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { createRyotHostMutation, createRyotHostQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	type PluginInstallationsPage,
	pluginInstallationsRecipe,
} from "@ryot-app/ryotql-recipes/plugin-installations";
import { Context, Effect, Layer, Schema } from "effect";

import { AuthenticatedApiError, isEntitlementRequiredError } from "#/api/authenticated";
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
>()("PluginManagementError", { detail: Message }) {}

const DeclaredPluginFailure = Schema.Union([
	PluginConflictError,
	PluginNotFoundError,
	PluginRequestError,
]);

const failureDetails: Record<(typeof DeclaredPluginFailure.Type)["reason"]["code"], Message> = {
	"system-plugin": kernelMessage("client.plugins.error.system-plugin"),
	"asset-forbidden": kernelMessage("client.plugins.error.asset-forbidden"),
	"plugin-not-found": kernelMessage("client.plugins.error.plugin-not-found"),
	"home-view-hidden": kernelMessage("client.plugins.error.home-view-hidden"),
	"changes-conflict": kernelMessage("client.plugins.error.changes-conflict"),
	"validation-failed": kernelMessage("client.plugins.error.validation-failed"),
	"already-installed": kernelMessage("client.plugins.error.already-installed"),
	"entity-referenced": kernelMessage("client.plugins.error.entity-referenced"),
	"compilation-failed": kernelMessage("client.plugins.error.compilation-failed"),
	"upload-unavailable": kernelMessage("client.plugins.error.upload-unavailable"),
	"operation-not-found": kernelMessage("client.plugins.error.operation-not-found"),
	"workflow-referenced": kernelMessage("client.plugins.error.workflow-referenced"),
	"home-view-not-found": kernelMessage("client.plugins.error.home-view-not-found"),
	"package-id-mismatch": kernelMessage("client.plugins.error.package-id-mismatch"),
	"saved-view-referenced": kernelMessage("client.plugins.error.saved-view-referenced"),
	"definition-referenced": kernelMessage("client.plugins.error.definition-referenced"),
	"source-revision-stale": kernelMessage("client.plugins.error.source-revision-stale"),
	"installation-not-found": kernelMessage("client.plugins.error.installation-not-found"),
	"integration-referenced": kernelMessage("client.plugins.error.integration-referenced"),
	"installation-not-ready": kernelMessage("client.plugins.error.installation-not-ready"),
	"package-archive-invalid": kernelMessage("client.plugins.error.package-archive-invalid"),
	"invalid-operation-scope": kernelMessage("client.plugins.error.invalid-operation-scope"),
	"schema-evolution-failed": kernelMessage("client.plugins.error.schema-evolution-failed"),
	"reserved-system-identity": kernelMessage("client.plugins.error.reserved-system-identity"),
	"operation-scope-not-found": kernelMessage("client.plugins.error.operation-scope-not-found"),
	"package-identity-conflict": kernelMessage("client.plugins.error.package-identity-conflict"),
	"page-write-access-required": kernelMessage("client.plugins.error.page-write-access-required"),
	"unsupported-manifest-surface": kernelMessage(
		"client.plugins.error.unsupported-manifest-surface",
	),
	"home-view-renderer-unavailable": kernelMessage(
		"client.plugins.error.home-view-renderer-unavailable",
	),
	"referenced-definition-incompatible": kernelMessage(
		"client.plugins.error.referenced-definition-incompatible",
	),
};

const rebuildRequiredIssues = new Set([
	"unexpected-entry",
	"manifest-invalid",
	"missing-manifest",
	"duplicate-manifest",
	"compiled-client-invalid",
	"compiled-script-invalid",
]);

const failureDetail = (failure: typeof DeclaredPluginFailure.Type) => {
	const { reason } = failure;
	if (reason.code !== "package-archive-invalid") {
		return failureDetails[reason.code];
	}
	if (rebuildRequiredIssues.has(reason.issue)) {
		return kernelMessage("client.plugins.error.rebuild-required");
	}
	return reason.issue.endsWith("-exceeded")
		? kernelMessage("client.plugins.error.archive-too-large")
		: failureDetails[reason.code];
};

const commandFailureDetail = (cause: unknown) => {
	if (isEntitlementRequiredError(cause)) {
		return kernelMessage("client.plugins.error.pro-required");
	}
	return cause instanceof AuthenticatedApiError && Schema.is(DeclaredPluginFailure)(cause.cause)
		? failureDetail(cause.cause)
		: kernelMessage("client.plugins.error.command-failed");
};

const commandFailure = (cause: unknown) =>
	new PluginManagementError({ detail: commandFailureDetail(cause) });

export const errorDetail = (t: (message: Message) => Text, error: null | Error) =>
	error instanceof PluginManagementError ? t(error.detail) : error?.message;

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
						() =>
							new PluginManagementError({
								detail: kernelMessage("client.plugins.error.load-failed"),
							}),
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
