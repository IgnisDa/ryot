import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import {
	type DownloadResolutionResponse,
	type ManagedAssetLocator,
	UploadBadRequest,
	UploadInternalError,
} from "@ryot-app/contract/modules/assets/schemas";
import type {
	PluginAssetBridgeErrorReason,
	PluginAssetOutcome,
	PluginManagedAssetResolution,
} from "@ryot-app/plugin-client-contract";
import { Context, Effect, Layer, Schema } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { resolveApiUrl, type ServerOrigin } from "#/api/origin";
import type { ApiScope } from "#/api/scope";
import { UploadsApi } from "#/api/uploads";

export class ManagedAssetResolutionError extends Schema.TaggedError<
	ManagedAssetResolutionError,
	{ readonly brand: unique symbol }
>()("ManagedAssetResolutionError", { cause: Schema.Unknown }) {}

const isUploadFailure = Schema.is(Schema.Union([UploadBadRequest, UploadInternalError]));

const isAuthenticationFailure = Schema.is(Schema.Union([AuthRateLimited, AuthUnauthorized]));

export const classifyManagedAssetCause = (
	cause: unknown,
	isAccessFailure: (cause: unknown) => boolean,
): PluginAssetBridgeErrorReason =>
	isUploadFailure(cause) || isAccessFailure(cause) ? "asset-failed" : "transport";

export const classifyManagedAssetFailure = (error: unknown): PluginAssetBridgeErrorReason =>
	error instanceof AuthenticatedApiError
		? classifyManagedAssetCause(error.cause, isAuthenticationFailure)
		: "transport";

export const mapManagedAssetResolutions = (
	serverUrl: ServerOrigin,
	response: DownloadResolutionResponse,
): PluginManagedAssetResolution[] =>
	response.map(({ asset, expiresAt, downloadUrl }) => ({
		asset,
		expiresAt,
		url: resolveApiUrl(serverUrl, downloadUrl),
	}));

export class ManagedAssetsService extends Context.Service<ManagedAssetsService>()(
	"@ryot-app/kernel-client/modules/assets/managed-assets/ManagedAssetsService",
	{
		make: Effect.gen(function* () {
			const api = yield* UploadsApi;
			const read = Effect.fn("ManagedAssetsService.read")(function* (
				scope: ApiScope,
				assets: readonly ManagedAssetLocator[],
			) {
				if (assets.length === 0) {
					return [];
				}
				return yield* api
					.resolveDownloads(scope, { payload: { assets: [...assets] } })
					.pipe(
						Effect.mapBoth({
							onFailure: (error) => new ManagedAssetResolutionError({ cause: error.cause }),
							onSuccess: (response) => mapManagedAssetResolutions(scope.serverUrl, response),
						}),
					);
			});
			const outcome = (
				scope: ApiScope,
				assets: readonly ManagedAssetLocator[],
			): Effect.Effect<PluginAssetOutcome> =>
				read(scope, assets).pipe(
					Effect.match({
						onSuccess: (resolutions) => ({ resolutions, outcome: "success" }) as const,
						onFailure: (error) =>
							({
								outcome: "failure",
								reason: classifyManagedAssetCause(error.cause, isAuthenticationFailure),
							}) as const,
					}),
				);
			return { read, outcome };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
