import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import type { BadRequest, DbError, NotFound } from "@ryot-app/contract/errors";
import {
	PluginConflictError,
	PluginInvocationError,
	PluginNotFoundError,
	PluginOperationRejected,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import {
	AutomationExecutionId,
	type IntegrationId,
	PluginId,
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
import { AccountAdmission } from "#modules/mutations/account-admission";
import {
	type IdempotencyIdentity,
	idempotencyIdentity,
	IdempotencyKeys,
} from "#modules/mutations/idempotency";
import { requireOpenSubmission } from "#modules/mutations/submission-window";
import { samePluginPin, ScriptPluginRevision } from "#modules/scripts/authorization/principal";
import { ScriptExecutionService } from "#modules/scripts/executions/service";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { SandboxWorkflowReferenceRepository } from "#modules/scripts/registry/workflow-references";
import { mapDatabaseErrors } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";

import { PluginRuntimeResolver } from "../catalog/runtime-resolver";
import { PluginRepository } from "../packages/repository";

type AdmittedDispatch = DispatchInput & { readonly resultIdentity: null | IdempotencyIdentity };

type IntegrationOperationScope = {
	readonly userId: UserId;
	readonly integrationId: IntegrationId;
	readonly pluginInstallationId: string;
};

type DispatchInput = {
	readonly userId: UserId;
	readonly payload: JsonValue;
	readonly pluginId: PluginId;
	readonly executionId: string;
	readonly operationSlug: string;
	readonly scriptId: SandboxScriptId;
	readonly integrationId?: IntegrationId;
	readonly accountGeneration: AccountGeneration;
	readonly pluginRevision: ScriptPluginRevision;
};
export class IntegrationOperationScopeResolver extends Context.Service<
	IntegrationOperationScopeResolver,
	{
		resolve: (
			payload: unknown,
		) => Effect.Effect<IntegrationOperationScope, DbError | NotFound | BadRequest>;
	}
>()(
	"@ryot-app/kernel-backend/modules/plugins/operations/service/IntegrationOperationScopeResolver",
) {}

export class OperationsService extends Context.Service<OperationsService>()(
	"@ryot-app/kernel-backend/modules/plugins/operations/service/OperationsService",
	{
		make: Effect.gen(function* () {
			const auth = yield* AuthService;
			const database = yield* DatabaseSession;
			const repository = yield* PluginRepository;
			const runtime = yield* PluginRuntimeResolver;
			const sandbox = yield* ScriptExecutionService;
			const integrationScopeResolver = yield* IntegrationOperationScopeResolver;
			const keys = yield* IdempotencyKeys.make;
			const admission = yield* AccountAdmission.make;
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
				if (result.error?.data?.code === "operation-rejected") {
					return yield* new PluginOperationRejected({ message: result.error.message });
				}
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
				readonly submittedAt?: string;
				readonly operationSlug: string;
				readonly idempotencyKey?: string;
				readonly packageId: PluginPackageId;
				readonly headers: PlatformHeaders.Headers;
			}) {
				if (input.submittedAt !== undefined) {
					yield* requireOpenSubmission(input.submittedAt);
				}
				const operation = { packageId: input.packageId, operationSlug: input.operationSlug };
				const operationNotFound = new PluginNotFoundError({
					reason: { code: "operation-not-found", ...operation },
				});
				const scopeNotFound = new PluginNotFoundError({
					reason: { code: "operation-scope-not-found", ...operation },
				});
				const contentHash = input.contentHash;
				const resolveOperation = Effect.fn(function* (userId: UserId) {
					yield* repository.lockIngestionShared([userId]);
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
					if (
						!(yield* repository.isActiveRevision({ contentHash, pluginId: resolved.plugin.id }))
					) {
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
					dispatchInput: Omit<DispatchInput, "executionId" | "pluginRevision">,
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
					const request = {
						payload: input.payload,
						pluginId: dispatchInput.pluginId,
						operationSlug: input.operationSlug,
						integrationId: dispatchInput.integrationId ?? null,
					};
					const admissionIdentity = idempotencyIdentity({
						request,
						key: executionId,
						userId: dispatchInput.userId,
						kind: "plugin-operation:admit",
					});
					const resultIdentity = idempotencyIdentity({
						request,
						key: executionId,
						userId: dispatchInput.userId,
						kind: "plugin-operation:result",
					});
					const admissionSchema = Schema.Struct({
						scriptId: SandboxScriptId,
						executionId: Schema.String,
						pluginRevision: ScriptPluginRevision,
					});
					const existing =
						input.idempotencyKey === undefined
							? null
							: yield* keys
									.read(admissionIdentity, admissionSchema)
									.pipe(
										Effect.catchTag(
											"IdempotencyConflict",
											() =>
												new PluginRequestError({
													reason: {
														code: "validation-failed",
														diagnostics: [
															{
																phase: "validate",
																severity: "error",
																code: "operation-idempotency-conflict",
																message:
																	"Operation idempotency key was reused with different input",
															},
														],
													},
												}),
										),
									);
					if (existing) {
						return {
							...dispatchInput,
							resultIdentity,
							scriptId: existing.response.scriptId,
							executionId: existing.response.executionId,
							pluginRevision: existing.response.pluginRevision,
						} satisfies AdmittedDispatch;
					}
					const subject = {
						type: "user" as const,
						userId: dispatchInput.userId,
						accountGeneration: dispatchInput.accountGeneration,
						...(dispatchInput.integrationId ? { integrationId: dispatchInput.integrationId } : {}),
					};
					const pin = yield* scripts
						.getScriptPin(dispatchInput.scriptId, undefined, subject)
						.pipe(
							Effect.catchTag("SandboxRunError", (error) =>
								Effect.fail(
									error.data?.code === "package-identity-conflict"
										? new PluginConflictError({
												reason: {
													packageId: input.packageId,
													code: "package-identity-conflict",
													pluginId: PluginId.make(resolved.plugin.id),
												},
											})
										: operationNotFound,
								),
							),
						);
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
					yield* admission.admitAccount(dispatchInput.accountGeneration);
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
						yield* keys.record(admissionIdentity, admissionSchema, {
							executionId,
							scriptId: dispatchInput.scriptId,
							pluginRevision: pin.pluginRevision,
						});
					}
					return {
						...dispatchInput,
						executionId,
						pluginRevision: pin.pluginRevision,
						resultIdentity: input.idempotencyKey === undefined ? null : resultIdentity,
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
												: yield* admission.currentAccount(scope.userId),
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
								accountGeneration: yield* admission.currentAccount(owner.userId),
							},
							resolved,
						);
					});
				const authorized = yield* mapDatabaseErrors(
					database
						.transaction(resolveAuthorized())
						.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die)),
				);
				const { resultIdentity } = authorized;
				if (resultIdentity) {
					const completed = yield* keys
						.read(resultIdentity, JsonValue)
						.pipe(Effect.catchTag("IdempotencyConflict", Effect.die));
					if (completed) {
						return completed.response;
					}
				}
				const result = yield* dispatch(authorized);
				if (resultIdentity) {
					yield* keys.record(resultIdentity, JsonValue, result);
				}
				return result;
			});

			return { invoke };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
