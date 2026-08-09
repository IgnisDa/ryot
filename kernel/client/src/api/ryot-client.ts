import { createRyotClient, RyotClientError } from "@ryot-app/client-sdk";
import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import { UploadBadRequest, UploadInternalError } from "@ryot-app/contract/modules/uploads/schemas";
import { Effect, Schema } from "effect";

import { AuthenticatedApiError } from "#/api/authenticated";
import { resolveApiUrl } from "#/api/origin";
import { classifyRyotQLFailure, RyotQLApi } from "#/api/ryotql";
import type { ApiScope } from "#/api/scope";
import { UploadsApi } from "#/api/uploads";
import type { ThemeStore } from "#/modules/theme/store";

type KernelApiRuntime = {
	readonly runPromise: <A, E>(
		effect: Effect.Effect<A, E, RyotQLApi | UploadsApi>,
		options?: Effect.RunOptions,
	) => Promise<A>;
};

const isDeclaredUploadFailure = Schema.is(
	Schema.Union([AuthRateLimited, AuthUnauthorized, UploadBadRequest, UploadInternalError]),
);

const classifyUploadFailure = (error: unknown) =>
	error instanceof AuthenticatedApiError && isDeclaredUploadFailure(error.cause)
		? "operation-failed"
		: "transport";

export const createKernelRyotClient = (
	runtime: KernelApiRuntime,
	scope: ApiScope,
	theme: ThemeStore,
) => {
	const runUpload = async <A>(
		call: (api: UploadsApi["Service"]) => Effect.Effect<A, AuthenticatedApiError>,
	) => {
		try {
			return await runtime.runPromise(UploadsApi.pipe(Effect.flatMap(call)));
		} catch (error) {
			throw new RyotClientError(classifyUploadFailure(error));
		}
	};

	return createRyotClient({
		theme,
		query: async (document, signal) => {
			try {
				return await runtime.runPromise(
					RyotQLApi.pipe(Effect.flatMap((api) => api.execute(scope, { payload: document }))),
					{ signal },
				);
			} catch (error) {
				if (signal?.aborted) {
					throw signal.reason;
				}
				throw new RyotClientError(classifyRyotQLFailure(error));
			}
		},
		uploadTemporary: async ({ source, fileName, contentType }) => {
			const intent = await runUpload((api) =>
				api.createIntent(scope, { payload: { kind: "temporary", fileName, contentType } }),
			);
			let response: Response;
			try {
				response = await fetch(resolveApiUrl(scope.serverUrl, intent.uploadUrl), {
					body: source,
					method: intent.method,
					headers: { ...intent.headers },
				});
			} catch {
				throw new RyotClientError("transport");
			}
			if (!response.ok) {
				throw new RyotClientError("operation-failed");
			}
			return await runUpload((api) =>
				api.completeIntent(scope, { params: { intentId: intent.intentId } }),
			);
		},
	});
};

export type KernelRyotClient = ReturnType<typeof createKernelRyotClient>;
