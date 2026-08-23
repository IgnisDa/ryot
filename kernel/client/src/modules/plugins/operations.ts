import { AuthRateLimited, AuthUnauthorized } from "@ryot/contract/auth-middleware";
import type {
	PluginOperationBridgeErrorReason,
	PluginOperationOutcome,
	PluginOperationRequest,
} from "@ryot/contract/modules/plugins/client";
import {
	PluginInvocationError,
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot/contract/modules/plugins/schemas";
import { PluginSlug } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer, Schema } from "effect";

import { AuthenticatedApi } from "#/api/authenticated";
import type { ApiScope } from "#/api/scope";

const isDeclaredFailure = Schema.is(
	Schema.Union([
		AuthRateLimited,
		AuthUnauthorized,
		PluginRequestError,
		PluginNotFoundError,
		PluginInvocationError,
	]),
);

export class PluginOperationsService extends Context.Service<PluginOperationsService>()(
	"PluginOperationsService",
	{
		make: Effect.gen(function* () {
			const api = yield* AuthenticatedApi;
			const invoke = Effect.fn("PluginOperationsService.invoke")(function* (invocation: {
				readonly scope: ApiScope;
				readonly sourceHash: string;
				readonly pluginSlug: string;
				readonly request: PluginOperationRequest;
			}) {
				const outcome = yield* api
					.run(invocation.scope, (client) =>
						client.plugins.invoke({
							payload: {
								payload: invocation.request.input,
								sourceHash: invocation.sourceHash,
							},
							params: {
								operationSlug: invocation.request.operationSlug,
								pluginSlug: PluginSlug.make(invocation.pluginSlug),
							},
						}),
					)
					.pipe(
						Effect.match({
							onSuccess: (response) => ({ outcome: "success", value: response.result }) as const,
							onFailure: (error) => {
								const reason = (
									isDeclaredFailure(error.cause) ? "operation-failed" : "transport"
								) satisfies PluginOperationBridgeErrorReason;
								return { reason, outcome: "failure" } as const;
							},
						}),
					);
				return outcome satisfies PluginOperationOutcome;
			});

			return { invoke };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
