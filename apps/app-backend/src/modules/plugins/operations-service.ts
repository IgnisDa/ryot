import type { Headers as PlatformHeaders } from "@effect/platform";
import { badRequest, notFound, SandboxRunError } from "@ryot/contract/errors";
import { IntegrationId, type UserId } from "@ryot/contract/schema/brands";
import type { PluginOperationAuth } from "@ryot/plugin-kit/manifest";
import { generateId } from "better-auth";
import { Effect, Schema } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";
import { SandboxService as RuntimeSandboxService } from "#lib/infrastructure/sandbox-runtime/service";
import { AuthService } from "#modules/auth/service";
import { IntegrationsRepository } from "#modules/integrations/repository";
import { executeSandboxExecution } from "#modules/sandbox/durable-queues";
import { SandboxRepository } from "#modules/sandbox/repository";

import { PluginLoader } from "./loader";
import { PluginRuntimeResolver } from "./runtime-resolver";

const IntegrationPayload = Schema.Struct({ integrationId: Schema.String });

type DispatchInput = {
	readonly payload: unknown;
	readonly pluginSlug: string;
	readonly operationSlug: string;
	readonly userId: UserId;
};

export class OperationsService extends Effect.Service<OperationsService>()("OperationsService", {
	effect: Effect.gen(function* () {
		const auth = yield* AuthService;
		const loader = yield* PluginLoader;
		const runWithDb = yield* DbRunner;
		const runtime = yield* PluginRuntimeResolver;
		const sandbox = yield* RuntimeSandboxService;
		const sandboxRepository = yield* SandboxRepository;
		const integrationsRepository = yield* IntegrationsRepository;

		const resolveOperation = (pluginSlug: string, operationSlug: string) =>
			Effect.gen(function* () {
				const plugin = loader.getSnapshot().plugins[pluginSlug];
				const operation = plugin?.manifest.operations.find(({ slug }) => slug === operationSlug);
				if (!operation) {
					return yield* notFound(`Operation '${pluginSlug}/${operationSlug}' was not found`);
				}
				return operation;
			});

		const dispatch = Effect.fn("OperationsService.dispatch")(function* (input: DispatchInput) {
			const operation = yield* resolveOperation(input.pluginSlug, input.operationSlug);
			const script = yield* runWithDb(runtime.findActiveScript(operation.scriptSlug));
			if (!script) {
				return yield* new SandboxRunError({
					message: `Operation '${input.pluginSlug}/${input.operationSlug}' script is unavailable`,
				});
			}
			const executionId = `plugin-operation-${input.pluginSlug}-${input.operationSlug}-${generateId()}`;
			const result = yield* executeSandboxExecution({
				executionId,
				scriptId: script.id,
				context: input.payload,
				authority: { type: "user", userId: input.userId },
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

		const resolveIntegrationUserId = (payload: unknown) =>
			Effect.gen(function* () {
				const decodePayload = Schema.decodeUnknown(IntegrationPayload)(payload).pipe(
					Effect.mapError(() => badRequest("integrationId is required")),
				);
				const decoded = yield* decodePayload;
				const integration = yield* runWithDb(
					integrationsRepository.getByIdAnyUser({
						integrationId: IntegrationId.make(decoded.integrationId),
					}),
				);
				if (!integration || integration.isDisabled) {
					return yield* notFound("Integration not found");
				}
				return integration.userId;
			});

		const resolveUserId = (
			operationAuth: PluginOperationAuth,
			payload: unknown,
			headers: PlatformHeaders.Headers,
		) => {
			if (operationAuth === "user") {
				const getCurrentUser = auth
					.currentUser(new Headers(headers))
					.pipe(Effect.map((user) => user.id));
				return getCurrentUser;
			}
			return resolveIntegrationUserId(payload);
		};

		const invoke = Effect.fn("OperationsService.invoke")(function* (input: {
			readonly payload: unknown;
			readonly pluginSlug: string;
			readonly operationSlug: string;
			readonly headers: PlatformHeaders.Headers;
		}) {
			const operation = yield* resolveOperation(input.pluginSlug, input.operationSlug);
			const userId = yield* resolveUserId(operation.auth, input.payload, input.headers);
			return yield* dispatch({
				userId,
				payload: input.payload,
				pluginSlug: input.pluginSlug,
				operationSlug: input.operationSlug,
			});
		});

		const invokeOperation = Effect.fn("OperationsService.invokeOperation")(
			(input: {
				readonly payload: unknown;
				readonly pluginSlug: string;
				readonly operationSlug: string;
				readonly userId: UserId;
			}) => dispatch(input),
		);

		return { invoke, invokeOperation };
	}),
}) {}
