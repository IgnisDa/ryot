import type { Headers as PlatformHeaders } from "@effect/platform";
import { badRequest, notFound, SandboxRunError } from "@ryot/contract/errors";
import { IntegrationId, type SandboxScriptId, type UserId } from "@ryot/contract/schema/brands";
import type { PluginOperationAuth } from "@ryot/plugin-kit/manifest";
import { generateId } from "better-auth";
import { Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { AuthService } from "#modules/auth/service";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { executeSandboxExecution } from "#modules/sandbox/durable-queues";
import { SandboxRepository } from "#modules/sandbox/repository";

import { PluginRuntimeResolver } from "./runtime-resolver";

const IntegrationPayload = Schema.Struct({ integrationId: Schema.String });

type DispatchInput = {
	readonly userId: UserId;
	readonly payload: unknown;
	readonly scriptId: SandboxScriptId;
	readonly pluginSlug: string;
	readonly operationSlug: string;
	readonly integrationId?: IntegrationId;
};

export class OperationsService extends Effect.Service<OperationsService>()("OperationsService", {
	effect: Effect.gen(function* () {
		const auth = yield* AuthService;
		const runWithDb = yield* DbRunner;
		const runtime = yield* PluginRuntimeResolver;
		const sandbox = yield* RuntimeSandboxService;
		const sandboxRepository = yield* SandboxRepository;
		const integrationsRepository = yield* IntegrationsRepository;

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

		const resolveIntegrationScope = (payload: unknown) =>
			Effect.gen(function* () {
				const decodePayload = Schema.decodeUnknown(IntegrationPayload)(payload).pipe(
					Effect.mapError(() => badRequest("integrationId is required")),
				);
				const decoded = yield* decodePayload;
				const integrationId = IntegrationId.make(decoded.integrationId);
				const integration = yield* runWithDb(
					integrationsRepository.getByIdAnyUser({ integrationId }),
				);
				if (!integration || integration.isDisabled) {
					return yield* notFound("Integration not found");
				}
				return { integrationId, userId: integration.userId };
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
			return resolveIntegrationScope(payload);
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
