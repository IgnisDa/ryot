import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import type { BadRequest, DbError, NotFound } from "@ryot-app/contract/errors";
import {
	PluginConflictError,
	PluginInvocationError,
	PluginNotFoundError,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import {
	PluginId,
	type IntegrationId,
	type SandboxScriptId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { isJsonValue, type JsonValue } from "@ryot-app/contract/schema/json";
import { generateId } from "better-auth";
import { Context, Effect, Layer, Option, Result } from "effect";
import type { Headers as PlatformHeaders } from "effect/http";

import { mapDatabaseErrors } from "#lib/infrastructure/db/errors";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import type { SandboxPluginRevision } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { AuthService } from "#modules/auth/service";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow } from "#modules/mutations/workflow-dispatch";
import { SandboxRepository } from "#modules/sandbox/repository";
import { SandboxScriptWorkflow } from "#modules/sandbox/sandbox-script-workflow";
import { SandboxExecutionService } from "#modules/sandbox/service";
import { SandboxWorkflowReferenceRepository } from "#modules/sandbox/workflow-reference-repository";

import { PluginInstallationRepository } from "./installation-repository";
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
	readonly accountGeneration: AccountGeneration;
	readonly userId: UserId;
	readonly payload: JsonValue;
	readonly pluginId: PluginId;
	readonly executionId: string;
	readonly pluginRevision: SandboxPluginRevision;
	readonly operationSlug: string;
	readonly scriptId: SandboxScriptId;
	readonly integrationId?: IntegrationId;
};

export class OperationsService extends Context.Service<OperationsService>()("OperationsService", {
	make: Effect.gen(function* () {
		const auth = yield* AuthService;
		const database = yield* DatabaseSession;
		const repository = yield* PluginRepository;
		const installations = yield* PluginInstallationRepository;
		const runtime = yield* PluginRuntimeResolver;
		const sandbox = yield* SandboxExecutionService;
		const integrationScopeResolver = yield* IntegrationOperationScopeResolver;
		const receipts = yield* MutationReceipts.make;
		const scripts = yield* SandboxRepository;
		const references = yield* SandboxWorkflowReferenceRepository;

		const dispatch = Effect.fn("OperationsService.dispatch")(function* (input: DispatchInput) {
			const result = yield* sandbox.executeScript({
				lane: "interactive",
				input: input.payload,
				scriptId: input.scriptId,
				executionId: input.executionId,
				pluginRevision: input.pluginRevision,
				subject: {
					type: "user",
					userId: input.userId,
					accountGeneration: input.accountGeneration,
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
			readonly pluginId: PluginId;
			readonly sourceHash?: string;
			readonly operationSlug: string;
			readonly headers: PlatformHeaders.Headers;
		}) {
			const operation = { pluginId: input.pluginId, operationSlug: input.operationSlug };
			const operationNotFound = new PluginNotFoundError({
				reason: { code: "operation-not-found", ...operation },
			});
			const scopeNotFound = new PluginNotFoundError({
				reason: { code: "operation-scope-not-found", ...operation },
			});
			const sourceHash = input.sourceHash;
			const staleRevision = new PluginConflictError({
				reason: { pluginId: operation.pluginId, code: "source-revision-stale" },
			});
			const resolveOperation = Effect.fn(function* (
				userId: UserId,
				checkPrivateQuarantine = false,
			) {
				if (checkPrivateQuarantine) {
					const privatePlugin = yield* repository.findPrivateByIdForUser(input.pluginId, userId);
					if (privatePlugin) {
						const installation = yield* installations.findByUserAndPlugin(userId, privatePlugin.id);
						if (
							installation?.health === "incompatible" &&
							installation.incompatibilityReason === "package-identity-conflict" &&
							installation.uninstalledAt === null
						) {
							return yield* new PluginConflictError({
								reason: {
									code: "package-identity-conflict",
									packageId: privatePlugin.packageId,
									pluginId: PluginId.make(privatePlugin.id),
								},
							});
						}
					}
				}
				const resolved = yield* runtime.findOperationAvailableToUser({
					userId,
					pluginId: input.pluginId,
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

			const authenticated = yield* auth.resolveRequestCredential(new Headers(input.headers)).pipe(
				Effect.map(Result.succeed),
				Effect.catchTag("AuthUnauthorized", (error) => Effect.succeed(Result.fail(error))),
			);
			const executionId = `plugin-operation-${input.pluginId}-${input.operationSlug}-${generateId()}`;
			const pinDispatch = Effect.fn("OperationsService.pinDispatch")(function* (
				dispatchInput: Omit<DispatchInput, "pluginRevision" | "executionId">,
				resolved: NonNullable<Effect.Success<ReturnType<typeof resolveOperation>>>,
			) {
				const subject = {
					type: "user" as const,
					userId: dispatchInput.userId,
					accountGeneration: dispatchInput.accountGeneration,
					...(dispatchInput.integrationId ? { integrationId: dispatchInput.integrationId } : {}),
				};
				const pin = yield* scripts.getScriptPin(dispatchInput.scriptId, undefined, subject);
				if (
					!pin?.pluginRevision ||
					pin.pluginRevision.id !== input.pluginId ||
					pin.pluginRevision.revisionId !== resolved.plugin.pluginRevisionId ||
					pin.pluginRevision.configRevisionId !== resolved.plugin.pluginConfigRevisionId ||
					pin.pluginRevision.packageId !== resolved.plugin.packageId ||
					pin.contentHash !== resolved.script.contentHash ||
					pin.scriptSlug !== resolved.operation.scriptSlug ||
					pin.metadata.kind !== "operation"
				) {
					return yield* operationNotFound;
				}
				yield* admitWorkflow(
					receipts,
					SandboxScriptWorkflow,
					dispatchInput.accountGeneration,
					executionId,
				);
				yield* references
					.registerInTransaction({
						executionId,
						userId: dispatchInput.userId,
						contentHash: pin.contentHash,
						pluginId: pin.pluginRevision.id,
						scriptId: dispatchInput.scriptId,
					})
					.pipe(
						Effect.catchTag("SandboxWorkflowReferenceRegistrationError", () => operationNotFound),
					);
				return {
					...dispatchInput,
					executionId,
					pluginRevision: pin.pluginRevision,
				} satisfies DispatchInput;
			});

			const resolveAuthorized = () =>
				Effect.gen(function* () {
					if (Result.isSuccess(authenticated)) {
						const { user, authorization } = authenticated.success;
						const userId = user.id;
						const resolved = yield* resolveOperation(userId, true);
						if (resolved?.operation.auth === "user") {
							if (
								authorization.accessClass === "demo" &&
								(resolved.plugin.scope !== "system" ||
									resolved.operation.demoAccess === "protected")
							) {
								return yield* new DemoOperationProtected({
									reason: { code: "demo-operation-protected" },
								});
							}
							return yield* pinDispatch(
								{
									userId,
									payload: input.payload,
									pluginId: input.pluginId,
									scriptId: resolved.script.id,
									operationSlug: input.operationSlug,
									accountGeneration: user.accountGeneration,
								},
								resolved,
							);
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
							return yield* pinDispatch(
								{
									userId: scope.userId,
									payload: input.payload,
									pluginId: input.pluginId,
									scriptId: resolved.script.id,
									integrationId: scope.integrationId,
									operationSlug: input.operationSlug,
									accountGeneration:
										user.id === scope.userId
											? user.accountGeneration
											: yield* receipts.currentAccount(scope.userId),
								},
								resolved,
							);
						}
					}

					const scope = yield* resolveIntegrationScope.pipe(
						Effect.asSome,
						Effect.catchTag("BadRequest", () => Effect.succeedNone),
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
					return yield* pinDispatch(
						{
							userId: owner.userId,
							payload: input.payload,
							pluginId: input.pluginId,
							scriptId: resolved.script.id,
							integrationId: owner.integrationId,
							operationSlug: input.operationSlug,
							accountGeneration: yield* receipts.currentAccount(owner.userId),
						},
						resolved,
					);
				});
			const authorized = yield* mapDatabaseErrors(
				database
					.transaction(
						Effect.gen(function* () {
							yield* repository.lockIngestionShared();
							return yield* resolveAuthorized();
						}),
					)
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
			);
			return yield* dispatch(authorized);
		});

		return { invoke };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
