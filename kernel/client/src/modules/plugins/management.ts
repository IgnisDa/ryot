import { createRyotMutation, createRyotQuery } from "@ryot-app/client-sdk/react";
import {
	PluginConflictError,
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import { JsonValue } from "@ryot-app/contract/schema/json";
import {
	pluginInstallationsRecipe,
	type PluginInstallationsPage,
} from "@ryot-app/ryotql-recipes/plugin-installations";
import { Context, Data, Effect, Layer, Schema } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { PluginInstallationsApi } from "#/api/plugin-installations";
import type { KernelRyotClient } from "#/api/ryot-client";
import type { ApiScope } from "#/api/scope";
import type { KernelHostServices } from "#/host-services";
import { TemporaryUploads } from "#/modules/assets/temporary-uploads";

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

const commandFailure = (cause: unknown) => {
	const declared = Schema.is(
		Schema.Union([PluginConflictError, PluginNotFoundError, PluginRequestError]),
	);
	return new PluginManagementError({
		detail:
			cause instanceof AuthenticatedApiError && declared(cause.cause)
				? JSON.stringify(cause.cause.reason)
				: "The plugin command failed. No other installation was selected.",
	});
};

export class PluginManagementService extends Context.Service<PluginManagementService>()(
	"PluginManagementService",
	{
		make: Effect.gen(function* () {
			const api = yield* PluginInstallationsApi;
			const uploads = yield* TemporaryUploads;
			const load = Effect.fn("PluginManagement.load")(function* (
				client: Pick<KernelRyotClient, "data">,
			) {
				const installations: ManagedPluginInstallation[] = [];
				let after: string | undefined;
				do {
					const page = yield* client.data
						.query(pluginInstallationsRecipe({ after, limit: 100 }))
						.pipe(
							Effect.mapError(
								() => new PluginManagementError({ detail: "Could not load plugin installations." }),
							),
						);
					installations.push(...page.items);
					if (page.pageInfo.hasMore && page.pageInfo.nextCursor === null) {
						return yield* new PluginManagementError({
							detail: "The plugin catalog omitted its next cursor.",
						});
					}
					after = page.pageInfo.nextCursor ?? undefined;
				} while (after !== undefined);
				return installations;
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
				if (installation.scope !== "user") {
					return yield* new PluginManagementError({
						detail:
							"Deployment administrators manage system package configuration, updates, and removal.",
					});
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
					const token = yield* uploads
						.upload(scope, {
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
					return yield* api
						.updatePackage(scope, {
							params,
							payload: { uploadToken: token.token, sourceHash: installation.sourceHash },
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
	Layer.provide(Layer.mergeAll(PluginInstallationsApi.layer, TemporaryUploads.layer)),
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
