import { createRyotClient, RyotClientError } from "@ryot-app/client-sdk";
import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import type { ContractProgram } from "@ryot-app/contract/client";
import { UploadBadRequest, UploadInternalError } from "@ryot-app/contract/modules/uploads/schemas";
import { Effect, Schema } from "effect";

import { AuthenticatedApi, AuthenticatedApiError } from "#/api/authenticated";
import { resolveApiUrl } from "#/api/origin";
import { classifyRyotQLFailure } from "#/api/ryotql";
import type { ApiScope } from "#/api/scope";
import type { ThemeStore } from "#/modules/theme/store";

type AuthenticatedApiRuntime = {
	readonly runPromise: <A, E>(
		effect: Effect.Effect<A, E, AuthenticatedApi>,
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
	runtime: AuthenticatedApiRuntime,
	scope: ApiScope,
	theme: ThemeStore,
) => {
	const runUpload = async <A, E>(program: ContractProgram<A, E>) => {
		try {
			return await runtime.runPromise(
				AuthenticatedApi.pipe(Effect.flatMap((api) => api.run(scope, program))),
			);
		} catch (error) {
			throw new RyotClientError(classifyUploadFailure(error));
		}
	};

	return createRyotClient({
		theme,
		query: async (document, signal) => {
			try {
				return await runtime.runPromise(
					AuthenticatedApi.pipe(
						Effect.flatMap((api) =>
							api.run(scope, (client) => client.ryotql.execute({ payload: document })),
						),
					),
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
			const intent = await runUpload((client) =>
				client.uploads.createIntent({ payload: { kind: "temporary", fileName, contentType } }),
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
			return await runUpload((client) =>
				client.uploads.completeIntent({ params: { intentId: intent.intentId } }),
			);
		},
	});
};

export type KernelRyotClient = ReturnType<typeof createKernelRyotClient>;
