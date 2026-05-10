import type { BadRequest, DbError, NotFound } from "@ryot/contract/errors";
import type { PluginOperationAuth } from "@ryot/contract/modules/plugins/manifest";
import {
	PluginInvocationError,
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot/contract/modules/plugins/schemas";
import {
	type IntegrationId,
	PluginSlug,
	type SandboxScriptId,
	type UserId,
} from "@ryot/contract/schema/brands";
import { generateId } from "better-auth";
import { Context, Effect, Layer } from "effect";
import type { Headers as PlatformHeaders } from "effect/unstable/http";

import { AuthService } from "#modules/auth/service";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { PluginRuntimeResolver } from "./runtime-resolver";

type IntegrationOperationScope = {
	readonly userId: UserId;
	readonly integrationId: IntegrationId;
};

export class IntegrationOperationScopeResolver extends Context.Service<
	IntegrationOperationScopeResolver,
	{
		resolve: (
			payload: unknown,
		) => Effect.Effect<IntegrationOperationScope, BadRequest | DbError | NotFound>;
	}
>()("IntegrationOperationScopeResolver") {}

type DispatchInput = {
	readonly userId: UserId;
	readonly payload: unknown;
	readonly pluginSlug: string;
	readonly operationSlug: string;
	readonly scriptId: SandboxScriptId;
	readonly integrationId?: IntegrationId;
};

export class OperationsService extends Context.Service<OperationsService>()("OperationsService", {
	make: Effect.gen(function* () {
		const auth = yield* AuthService;
		const runtime = yield* PluginRuntimeResolver;
		const sandbox = yield* SandboxExecutionService;
		const integrationScopeResolver = yield* IntegrationOperationScopeResolver;

		const dispatch = Effect.fn("OperationsService.dispatch")(function* (input: DispatchInput) {
			const executionId = `plugin-operation-${input.pluginSlug}-${input.operationSlug}-${generateId()}`;
			const result = yield* sandbox.executeScript({
				executionId,
				input: input.payload,
				scriptId: input.scriptId,
				authority: {
					type: "user",
					userId: input.userId,
					...(input.integrationId ? { integrationId: input.integrationId } : {}),
				},
			});
			if (result.error) {
				return yield* new PluginInvocationError({
					reason: {
						code: "runtime-failed",
						diagnostics: [
							{
								phase: result.error.phase,
								message: result.error.message,
								code: "sandbox-runtime-error",
								severity: "error",
								...(!("line" in result.error) || result.error.line === undefined
									? {}
									: { line: result.error.line }),
								...(!("column" in result.error) || result.error.column === undefined
									? {}
									: { column: result.error.column }),
							},
						],
					},
				});
			}
			return result.value;
		});

		const resolveScope = (
			operationAuth: PluginOperationAuth,
			payload: unknown,
			headers: PlatformHeaders.Headers,
			operation: { readonly pluginSlug: PluginSlug; readonly operationSlug: string },
		) => {
			if (operationAuth === "user") {
				const getCurrentUser = auth
					.currentUser(new Headers(headers))
					.pipe(Effect.map((user) => ({ userId: user.id })));
				return getCurrentUser;
			}
			return integrationScopeResolver.resolve(payload).pipe(
				Effect.catchTags({
					BadRequest: () =>
						Effect.fail(
							new PluginRequestError({ reason: { code: "invalid-operation-scope", ...operation } }),
						),
					NotFound: () =>
						Effect.fail(
							new PluginNotFoundError({
								reason: { code: "operation-scope-not-found", ...operation },
							}),
						),
				}),
			);
		};

		const invoke = Effect.fn("OperationsService.invoke")(function* (input: {
			readonly payload: unknown;
			readonly pluginSlug: string;
			readonly operationSlug: string;
			readonly headers: PlatformHeaders.Headers;
		}) {
			const operation = {
				operationSlug: input.operationSlug,
				pluginSlug: PluginSlug.make(input.pluginSlug),
			};
			const resolved = yield* runtime.findActiveOperation({
				pluginSlug: input.pluginSlug,
				operationSlug: input.operationSlug,
			});
			if (resolved) {
				const scope = yield* resolveScope(
					resolved.operation.auth,
					input.payload,
					input.headers,
					operation,
				);
				const script = yield* resolved.script;
				if (!script) {
					return yield* new PluginInvocationError({
						reason: { code: "script-unavailable", ...operation },
					});
				}
				return yield* dispatch({
					...scope,
					scriptId: script.id,
					payload: input.payload,
					pluginSlug: input.pluginSlug,
					operationSlug: input.operationSlug,
				});
			}
			const user = yield* auth.currentUser(new Headers(input.headers));
			const owned = yield* runtime.findUserOperation({
				userId: user.id,
				pluginSlug: input.pluginSlug,
				operationSlug: input.operationSlug,
			});
			if (!owned) {
				return yield* new PluginNotFoundError({
					reason: { code: "operation-not-found", ...operation },
				});
			}
			if (owned.operation.auth === "integration") {
				return yield* new PluginRequestError({
					reason: { code: "invalid-operation-scope", ...operation },
				});
			}
			return yield* dispatch({
				userId: user.id,
				payload: input.payload,
				scriptId: owned.script.id,
				pluginSlug: input.pluginSlug,
				operationSlug: input.operationSlug,
			});
		});

		return { invoke };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
