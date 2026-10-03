import type {
	PluginOperationBridgeErrorReason,
	PluginOperationOutcome,
	PluginOperationRequest,
} from "@ryot-app/client-plugin-contract";
import { AuthRateLimited, AuthUnauthorized } from "@ryot-app/contract/auth-middleware";
import {
	PluginConflictError,
	PluginInvocationError,
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import { PluginSlug } from "@ryot-app/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";

import { isDemoOperationProtectedError } from "#/api/authenticated";
import { PluginsApi } from "#/api/plugins";
import type { ApiScope } from "#/api/scope";

const isDeclaredFailure = Schema.is(
	Schema.Union([
		AuthRateLimited,
		AuthUnauthorized,
		PluginConflictError,
		PluginRequestError,
		PluginNotFoundError,
		PluginInvocationError,
	]),
);

const isStaleRevision = (cause: unknown) =>
	Schema.is(PluginConflictError)(cause) && cause.reason.code === "source-revision-stale";

export type PluginOperationDispatchOutcome =
	| PluginOperationOutcome
	| { readonly outcome: "stale-session" };

export class PluginOperationsService extends Context.Service<PluginOperationsService>()(
	"PluginOperationsService",
	{
		make: Effect.gen(function* () {
			const api = yield* PluginsApi;
			const invoke = Effect.fn("PluginOperationsService.invoke")(function* (invocation: {
				readonly scope: ApiScope;
				readonly sourceHash: string;
				readonly request: PluginOperationRequest;
			}) {
				const outcome = yield* api
					.invoke(invocation.scope, {
						payload: { payload: invocation.request.input, sourceHash: invocation.sourceHash },
						params: {
							operationSlug: invocation.request.operationSlug,
							pluginSlug: PluginSlug.make(invocation.request.pluginSlug),
						},
					})
					.pipe(
						Effect.match({
							onSuccess: (response) => ({ outcome: "success", value: response.result }) as const,
							onFailure: (error) => {
								if (isStaleRevision(error.cause)) {
									return { outcome: "stale-session" } as const;
								}
								const reason = (
									isDeclaredFailure(error.cause) || isDemoOperationProtectedError(error)
										? "operation-failed"
										: "transport"
								) satisfies PluginOperationBridgeErrorReason;
								return { reason, outcome: "failure" } as const;
							},
						}),
					);
				return outcome satisfies PluginOperationDispatchOutcome;
			});

			return { invoke };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
