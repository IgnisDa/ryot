import type { Headers as PlatformHeaders } from "@effect/platform";
import type { BadRequest, DbError, NotFound } from "@ryot/contract/errors";
import { notFound, SandboxRunError } from "@ryot/contract/errors";
import type { IntegrationId, SandboxScriptId, UserId } from "@ryot/contract/schema/brands";
import type { PluginOperationAuth } from "@ryot/plugin-kit/manifest";
import { generateId } from "better-auth";
import { Context, Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { AuthService } from "#modules/auth/service";
import { executeSandboxExecution } from "#modules/sandbox/durable-queues";
import { SandboxRepository } from "#modules/sandbox/repository";

import { PluginRuntimeResolver } from "./runtime-resolver";

type IntegrationOperationScope = {
	readonly userId: UserId;
	readonly integrationId: IntegrationId;
};

export class IntegrationOperationScopeResolver extends Context.Tag(
	"IntegrationOperationScopeResolver",
)<
	IntegrationOperationScopeResolver,
	{
		resolve: (
			payload: unknown,
		) => Effect.Effect<IntegrationOperationScope, BadRequest | DbError | NotFound>;
	}
>() {}

type DispatchInput = {
	readonly userId: UserId;
	readonly payload: unknown;
	readonly pluginSlug: string;
	readonly operationSlug: string;
	readonly scriptId: SandboxScriptId;
	readonly integrationId?: IntegrationId;
};

export class OperationsService extends Effect.Service<OperationsService>()("OperationsService", {
	effect: Effect.gen(function* () {
		const auth = yield* AuthService;
		const runWithDb = yield* DbRunner;
		const runtime = yield* PluginRuntimeResolver;
		const sandbox = yield* RuntimeSandboxService;
		const sandboxRepository = yield* SandboxRepository;
		const integrationScopeResolver = yield* IntegrationOperationScopeResolver;

		const dispatch = Effect.fn("OperationsService.dispatch")(function* (input: DispatchInput) {
			const executionId = `plugin-operation-${input.pluginSlug}-${input.operationSlug}-${generateId()}`;
			const result = yield* executeSandboxExecution({
				executionId,
				context: input.payload,
				scriptId: input.scriptId,
				authority: {
					type: "user",
					userId: input.userId,
					...(input.integrationId ? { integrationId: input.integrationId } : {}),
				},
			}).pipe(
				Effect.provideService(DbRunner, runWithDb),
				Effect.provideService(RuntimeSandboxService, sandbox),
				Effect.provideService(SandboxRepository, sandboxRepository),
				Effect.catchTag("TimeoutError", (error) => new SandboxRunError({ message: error.message })),
			);
			if (result.error) {
				return yield* new SandboxRunError({ message: result.error.message });
			}
			return result.value;
		});

		const resolveScope = (
			operationAuth: PluginOperationAuth,
			payload: unknown,
			headers: PlatformHeaders.Headers,
		) => {
			if (operationAuth === "user") {
				const getCurrentUser = auth
					.currentUser(new Headers(headers))
					.pipe(Effect.map((user) => ({ userId: user.id })));
				return getCurrentUser;
			}
			return integrationScopeResolver.resolve(payload);
		};

		const invoke = Effect.fn("OperationsService.invoke")(function* (input: {
			readonly payload: unknown;
			readonly pluginSlug: string;
			readonly operationSlug: string;
			readonly headers: PlatformHeaders.Headers;
		}) {
			const resolved = yield* runtime.findActiveOperation({
				pluginSlug: input.pluginSlug,
				operationSlug: input.operationSlug,
			});
			if (!resolved) {
				return yield* notFound(
					`Operation '${input.pluginSlug}/${input.operationSlug}' was not found`,
				);
			}
			const scope = yield* resolveScope(resolved.operation.auth, input.payload, input.headers);
			const script = yield* runWithDb(resolved.script);
			if (!script) {
				return yield* new SandboxRunError({
					message: `Operation '${input.pluginSlug}/${input.operationSlug}' script is unavailable`,
				});
			}
			return yield* dispatch({
				...scope,
				scriptId: script.id,
				payload: input.payload,
				pluginSlug: input.pluginSlug,
				operationSlug: input.operationSlug,
			});
		});

		return { invoke };
	}),
}) {}
