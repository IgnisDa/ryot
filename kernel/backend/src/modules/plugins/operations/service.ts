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
	AutomationExecutionId,
	type IntegrationId,
	type PluginPackageId,
	SandboxScriptId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { isJsonValue, JsonValue } from "@ryot-app/contract/schema/json";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { generateId } from "better-auth";
import { Context, Effect, Layer, Option, Result, Schema } from "effect";
import type { Headers as PlatformHeaders } from "effect/http";

import { AuthService } from "#modules/accounts/auth/service";
import { MutationReceipts, type MutationReceiptIdentity } from "#modules/mutations/receipts";
import { admitWorkflow } from "#modules/mutations/workflow-dispatch";
import { samePluginPin, ScriptPluginRevision } from "#modules/scripts/authorization/principal";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { ScriptExecutionWorkflow } from "#modules/scripts/executions/workflow";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { mapDatabaseErrors } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";

import { PluginRuntimeResolver } from "../catalog/runtime-resolver";
import { PluginRepository } from "../packages/repository";

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
	readonly pluginRevision: ScriptPluginRevision;
	readonly operationSlug: string;
	readonly scriptId: SandboxScriptId;
	readonly integrationId?: IntegrationId;
};
type AdmittedDispatch = DispatchInput & {
	readonly admissionIdentity: MutationReceiptIdentity | null;
};

export class OperationsService extends Context.Service<OperationsService>()("OperationsService", {
	make: Effect.gen(function* () {
		const auth = yield* AuthService;
		const database = yield* DatabaseSession;
		const repository = yield* PluginRepository;
		const runtime = yield* PluginRuntimeResolver;
		const sandbox = yield* ScriptExecutionService;
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
			readonly contentHash?: string;
			readonly idempotencyKey?: string;
			readonly operationSlug: string;
			readonly packageId: PluginPackageId;
			readonly headers: PlatformHeaders.Headers;
		}) {
			const operation = { packageId: input.packageId, operationSlug: input.operationSlug };
			const operationNotFound = new PluginNotFoundError({
				reason: { code: "operation-not-found", ...operation },
			});
			const scopeNotFound = new PluginNotFoundError({
				reason: { code: "operation-scope-not-found", ...operation },
			});
			const contentHash = input.contentHash;
			const resolveOperation = Effect.fn(function* (userId: UserId) {
				const selected = yield* runtime.resolveUserPackage(userId, input.packageId);
				if (selected.kind === "absent") {
					return null;
				}
				if (selected.kind === "quarantined") {
					return yield* new PluginConflictError({
						reason: {
							packageId: input.packageId,
							pluginId: selected.pluginId,
							code: "package-identity-conflict",
						},
					});
				}
				const resolved = yield* runtime.findOperationAvailableToUser({
					userId,
					pluginId: selected.pluginId,
					operationSlug: input.operationSlug,
				});
				if (contentHash === undefined || !resolved) {
					return resolved;
				}
				const staleRevision = new PluginConflictError({
					reason: { pluginId: selected.pluginId, code: "source-revision-stale" },
				});
				if (resolved.plugin.contentHash !== contentHash) {
					return yield* staleRevision;
				}
				if (!(yield* repository.isActiveRevision({ contentHash, pluginId: resolved.plugin.id }))) {
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
			const pinDispatch = Effect.fn("OperationsService.pinDispatch")(function* (
				dispatchInput: Omit<DispatchInput, "pluginRevision" | "executionId">,
				resolved: NonNullable<Effect.Success<ReturnType<typeof resolveOperation>>>,
			) {
				const executionId = AutomationExecutionId.make(
					`plugin-operation-${sha256Base64Url(
						stableStringify([
							dispatchInput.accountGeneration,
							dispatchInput.pluginId,
							resolved.plugin.installationId,
							input.operationSlug,
							dispatchInput.integrationId ?? null,
							input.idempotencyKey ?? generateId(),
						]),
					)}`,
				);
				const admissionIdentity = {
					executionId,
					mutationScope: "user",
					rootExecutionId: executionId,
					id: `operation_${executionId}`,
					itemIdentity: input.operationSlug,
					ownerUserId: dispatchInput.userId,
					scopeUserId: dispatchInput.userId,
					commandKind: "plugin-operation:admit",
					accountGeneration: dispatchInput.accountGeneration,
					inputFingerprint: sha256Base64Url(stableStringify(input.payload)),
				} satisfies MutationReceiptIdentity;
				const admissionSchema = Schema.Struct({
					scriptId: SandboxScriptId,
					executionId: Schema.String,
					pluginRevision: ScriptPluginRevision,
				});
				const existing =
					input.idempotencyKey === undefined
						? null
						: yield* receipts
								.lookup(admissionIdentity, admissionSchema)
								.pipe(
									Effect.catchTag(
										"MutationReceiptIdentityConflict",
										() =>
											new PluginRequestError({
												reason: {
													code: "validation-failed",
													diagnostics: [
														{
															phase: "validate",
															severity: "error",
															code: "operation-idempotency-conflict",
															message: "Operation idempotency key was reused with different input",
														},
													],
												},
											}),
									),
								);
				if (existing) {
					return {
						...dispatchInput,
						admissionIdentity,
						scriptId: existing.result.scriptId,
						executionId: existing.result.executionId,
						pluginRevision: existing.result.pluginRevision,
					} satisfies AdmittedDispatch;
				}
				const subject = {
					type: "user" as const,
					userId: dispatchInput.userId,
					accountGeneration: dispatchInput.accountGeneration,
					...(dispatchInput.integrationId ? { integrationId: dispatchInput.integrationId } : {}),
				};
				const pin = yield* scripts.getScriptPin(dispatchInput.scriptId, undefined, subject);
				if (
					!pin?.pluginRevision ||
					pin.pluginRevision.id !== resolved.plugin.id ||
					!samePluginPin(pin.pluginRevision, resolved.plugin) ||
					pin.pluginRevision.packageId !== resolved.plugin.packageId ||
					pin.contentHash !== resolved.script.contentHash ||
					pin.scriptSlug !== resolved.operation.scriptSlug ||
					pin.metadata.kind !== "operation"
				) {
					return yield* operationNotFound;
				}
				yield* admitWorkflow(
					receipts,
					ScriptExecutionWorkflow,
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
				if (input.idempotencyKey !== undefined) {
					yield* receipts.insert({
						dispatch: [],
						identity: admissionIdentity,
						result: {
							executionId,
							scriptId: dispatchInput.scriptId,
							pluginRevision: pin.pluginRevision,
						},
					});
				}
				return {
					...dispatchInput,
					executionId,
					pluginRevision: pin.pluginRevision,
					admissionIdentity: input.idempotencyKey === undefined ? null : admissionIdentity,
				} satisfies AdmittedDispatch;
			});

			const resolveAuthorized = () =>
				Effect.gen(function* () {
					if (Result.isSuccess(authenticated)) {
						const { user, authorization } = authenticated.success;
						const userId = user.id;
						const resolved = yield* resolveOperation(userId);
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
									scriptId: resolved.script.id,
									operationSlug: input.operationSlug,
									accountGeneration: user.accountGeneration,
									pluginId: PluginId.make(resolved.plugin.id),
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
									scriptId: resolved.script.id,
									integrationId: scope.integrationId,
									operationSlug: input.operationSlug,
									pluginId: PluginId.make(resolved.plugin.id),
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
							scriptId: resolved.script.id,
							integrationId: owner.integrationId,
							operationSlug: input.operationSlug,
							pluginId: PluginId.make(resolved.plugin.id),
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
			const resultIdentity =
				authorized.admissionIdentity === null
					? null
					: {
							...authorized.admissionIdentity,
							commandKind: "plugin-operation:result",
							id: `operation_result_${authorized.executionId}`,
						};
			if (resultIdentity) {
				const completed = yield* receipts
					.peek(resultIdentity, JsonValue)
					.pipe(Effect.catchTag("MutationReceiptIdentityConflict", Effect.die));
				if (completed) {
					return completed.result;
				}
			}
			const result = yield* dispatch(authorized);
			if (resultIdentity) {
				yield* database
					.transaction(
						Effect.gen(function* () {
							const completed = yield* receipts
								.lookup(resultIdentity, JsonValue)
								.pipe(Effect.catchTag("MutationReceiptIdentityConflict", Effect.die));
							if (!completed) {
								yield* receipts.insert({ result, dispatch: [], identity: resultIdentity });
							}
						}),
					)
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
			}
			return result;
		});

		return { invoke };
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
