import type { BadRequest, DbError, NotFound } from "@ryot/contract/errors";
import {
	PluginConflictError,
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
import { isJsonValue, type JsonValue } from "@ryot/contract/schema/json";
import { generateId } from "better-auth";
import { Context, Effect, Layer, Option, Result } from "effect";
import type { Headers as PlatformHeaders } from "effect/unstable/http";

import { Database, mapDatabaseErrors } from "#lib/infrastructure/db/service";
import { AuthService } from "#modules/auth/service";
import { SandboxExecutionService } from "#modules/sandbox/service";

import { PluginRepository } from "./repository";
import { PluginRuntimeResolver } from "./runtime-resolver";

type IntegrationOperationScope = {
	readonly userId: UserId;
	readonly integrationId: IntegrationId;
	readonly pluginInstallationId: string;
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
	readonly payload: JsonValue;
	readonly pluginSlug: string;
	readonly operationSlug: string;
	readonly scriptId: SandboxScriptId;
	readonly integrationId?: IntegrationId;
};

export class OperationsService extends Context.Service<OperationsService>()("OperationsService", {
	make: Effect.gen(function* () {
		const auth = yield* AuthService;
		const database = yield* Database;
		const repository = yield* PluginRepository;
		const runtime = yield* PluginRuntimeResolver;
		const sandbox = yield* SandboxExecutionService;
		const integrationScopeResolver = yield* IntegrationOperationScopeResolver;

		const dispatch = Effect.fn("OperationsService.dispatch")(function* (input: DispatchInput) {
			const executionId = `plugin-operation-${input.pluginSlug}-${input.operationSlug}-${generateId()}`;
			const result = yield* sandbox.executeScript({
				executionId,
				input: input.payload,
				scriptId: input.scriptId,
				subject: {
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
								severity: "error",
								phase: result.error.phase,
								message: result.error.message,
								code: "sandbox-runtime-error",
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
			if (!isJsonValue(result.value)) {
				return yield* new PluginInvocationError({
					reason: {
						code: "runtime-failed",
						diagnostics: [
							{
								phase: "output",
								severity: "error",
								code: "sandbox-runtime-error",
								message: "Sandbox operation result must be JSON",
							},
						],
					},
				});
			}
			return result.value;
		});

		const invoke = Effect.fn("OperationsService.invoke")(function* (input: {
			readonly payload: JsonValue;
			readonly pluginSlug: string;
			readonly sourceHash?: string;
			readonly operationSlug: string;
			readonly headers: PlatformHeaders.Headers;
		}) {
			const operation = {
				operationSlug: input.operationSlug,
				pluginSlug: PluginSlug.make(input.pluginSlug),
			};
			const operationNotFound = new PluginNotFoundError({
				reason: { code: "operation-not-found", ...operation },
			});
			const scopeNotFound = new PluginNotFoundError({
				reason: { code: "operation-scope-not-found", ...operation },
			});
			const sourceHash = input.sourceHash;
			const staleRevision = new PluginConflictError({
				reason: { code: "source-revision-stale", pluginSlug: operation.pluginSlug },
			});
			const resolveOperation = Effect.fn(function* (userId: UserId) {
				const resolved = yield* runtime.findOperationAvailableToUser({
					userId,
					pluginSlug: input.pluginSlug,
					operationSlug: input.operationSlug,
				});
				if (sourceHash === undefined || !resolved) {
					return resolved;
				}
				if (resolved.plugin.sourceHash !== sourceHash) {
					return yield* staleRevision;
				}
				if (!(yield* repository.isActiveRevision({ sourceHash, pluginId: resolved.plugin.id }))) {
					return yield* staleRevision;
				}
				return resolved;
			});
			const resolveIntegrationScope = integrationScopeResolver
				.resolve(input.payload)
				.pipe(Effect.catchTag("NotFound", () => scopeNotFound));

			const authenticated = yield* auth.currentUser(new Headers(input.headers)).pipe(
				Effect.map((user) => Result.succeed(user.id)),
				Effect.catchTag("AuthUnauthorized", (error) => Effect.succeed(Result.fail(error))),
			);

			const resolveAuthorized = () =>
				Effect.gen(function* () {
					if (Result.isSuccess(authenticated)) {
						const userId = authenticated.success;
						const resolved = yield* resolveOperation(userId);
						if (resolved?.operation.auth === "user") {
							return {
								userId,
								payload: input.payload,
								scriptId: resolved.script.id,
								pluginSlug: input.pluginSlug,
								operationSlug: input.operationSlug,
							} satisfies DispatchInput;
						}
						if (resolved) {
							const scope = yield* resolveIntegrationScope.pipe(
								Effect.catchTag("BadRequest", () =>
									Effect.fail(
										new PluginRequestError({
											reason: { code: "invalid-operation-scope", ...operation },
										}),
									),
								),
							);
							if (scope.pluginInstallationId !== resolved.plugin.installationId) {
								return yield* operationNotFound;
							}
							return {
								userId: scope.userId,
								payload: input.payload,
								scriptId: resolved.script.id,
								pluginSlug: input.pluginSlug,
								integrationId: scope.integrationId,
								operationSlug: input.operationSlug,
							} satisfies DispatchInput;
						}
					}

					const scope = yield* resolveIntegrationScope.pipe(
						Effect.map(Option.some),
						Effect.catchTag("BadRequest", () => Effect.succeed(Option.none())),
					);
					if (Option.isNone(scope)) {
						return yield* Result.isFailure(authenticated)
							? authenticated.failure
							: operationNotFound;
					}
					const owner = scope.value;
					const resolved = yield* resolveOperation(owner.userId);
					if (
						resolved?.operation.auth !== "integration" ||
						resolved.plugin.installationId !== owner.pluginInstallationId
					) {
						return yield* operationNotFound;
					}
					return {
						userId: owner.userId,
						payload: input.payload,
						scriptId: resolved.script.id,
						pluginSlug: input.pluginSlug,
						integrationId: owner.integrationId,
						operationSlug: input.operationSlug,
					} satisfies DispatchInput;
				});
			const authorized =
				sourceHash === undefined
					? yield* resolveAuthorized()
					: yield* mapDatabaseErrors(
							database.transaction((transaction) =>
								Effect.gen(function* () {
									yield* repository.lockIngestion();
									return yield* resolveAuthorized();
								}).pipe(Effect.provideService(Database, transaction)),
							),
						);
			return yield* dispatch(authorized);
		});

		return { invoke };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
