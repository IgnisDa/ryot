import { WriteAccessDenied } from "@ryot-app/contract/auth-middleware";
import type { BadRequest, NotFound } from "@ryot-app/contract/errors";
import { DbError } from "@ryot-app/contract/errors";
import {
	ChangeSet,
	CommitConflictCode,
	CommittedChanges,
} from "@ryot-app/contract/modules/changes/change-set";
import type { PageOperationAuthority } from "@ryot-app/contract/modules/pages/identity";
import {
	PluginConflictError,
	PluginInvocationError,
	PluginNotFoundError,
	PluginOperationRejected,
	PluginRequestError,
} from "@ryot-app/contract/modules/plugins/schemas";
import {
	AutomationExecutionId,
	type IntegrationId,
	PluginId,
	type PluginPackageId,
	type SandboxScriptId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { entitlementRequired } from "@ryot-app/contract/schema/entitlement";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { Message } from "@ryot-app/i18n/message";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { generateId } from "better-auth";
import { Context, Effect, Layer, Option, Result, Schema } from "effect";
import type { Headers as PlatformHeaders } from "effect/http";

import { AuthService } from "#modules/accounts/auth/service";
import { ChangeSetRejected } from "#modules/changes/authority";
import type { ChangeSetFailure } from "#modules/changes/service";
import { ChangeSetAlreadyCommitted, ChangeSets, isEmptyChangeSet } from "#modules/changes/service";
import { AccountAdmission } from "#modules/mutations/account-admission";
import {
	type IdempotencyIdentity,
	idempotencyIdentity,
	IdempotencyKeys,
} from "#modules/mutations/idempotency";
import { requireOpenSubmission } from "#modules/mutations/submission-window";
import { PageOperationAuthorization } from "#modules/pages/operation-authority";
import { samePluginPin, ScriptExecutionPrincipal } from "#modules/scripts/authorization/principal";
import { ScriptCalls } from "#modules/scripts/executions/calls";
import {
	operationLifecycleCommand,
	sandboxStartedAt,
} from "#modules/scripts/host/execution-context";
import { SandboxRepository } from "#modules/scripts/registry/repository";
import { mapDatabaseErrors } from "#platform/db/errors";
import { DatabaseSession } from "#platform/db/session";
import { EntitlementService } from "#platform/entitlements";

import { PluginRuntimeResolver } from "../catalog/runtime-resolver";
import { PluginRepository } from "../packages/repository";
import { userOperationAccessFailure } from "./access";

type IntegrationOperationScope = {
	readonly userId: UserId;
	readonly integrationId: IntegrationId;
	readonly pluginInstallationId: string;
};

type AdmittedDispatch = DispatchInput & {
	readonly principal: ScriptExecutionPrincipal;
	readonly resultIdentity: null | IdempotencyIdentity;
};

type DispatchInput = {
	readonly userId: UserId;
	readonly payload: JsonValue;
	readonly pluginId: PluginId;
	readonly executionId: string;
	readonly operationSlug: string;
	readonly accountUserId: UserId;
	readonly scriptId: SandboxScriptId;
	readonly integrationId?: IntegrationId;
};
const OperationRunResult = Schema.Struct({
	output: JsonValue,
	changes: Schema.optional(ChangeSet),
});

const OperationReceipt = Schema.Struct({ output: JsonValue, committed: CommittedChanges });
type OperationReceipt = typeof OperationReceipt.Type;

const isCommitConflict = Schema.is(
	Schema.Struct({ reason: Schema.Struct({ code: CommitConflictCode }) }),
);
const isPolicyRejection = Schema.is(
	Schema.Struct({
		_tag: Schema.Literals(["EventBadRequest", "RelationshipBadRequest"]),
		reason: Schema.Struct({ message: Message, code: Schema.Literal("policy-rejected") }),
	}),
);

const invalidOutput = (message: string) =>
	new PluginInvocationError({
		reason: {
			code: "runtime-failed",
			diagnostics: [{ message, phase: "output", severity: "error", code: "sandbox-runtime-error" }],
		},
	});

const commitFailure = (error: typeof ChangeSetFailure.Type) => {
	if (error instanceof DbError) {
		return error;
	}
	if (isPolicyRejection(error)) {
		return new PluginOperationRejected({ reason: error.reason.message });
	}
	if (error instanceof ChangeSetRejected) {
		return invalidOutput(`Operation changes were rejected: ${error.message}`);
	}
	if (isCommitConflict(error)) {
		return new PluginConflictError({
			reason: { code: "changes-conflict", conflict: error.reason.code },
		});
	}
	const code = Schema.is(Schema.Struct({ reason: Schema.Struct({ code: Schema.String }) }))(error)
		? `: ${error.reason.code}`
		: "";
	return invalidOutput(`Operation changes were not committed (${error._tag}${code})`);
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
			const pageAuthorization = yield* PageOperationAuthorization.make;
			const repository = yield* PluginRepository;
			const runtime = yield* PluginRuntimeResolver;
			const integrationScopeResolver = yield* IntegrationOperationScopeResolver;
			const keys = yield* IdempotencyKeys.make;
			const admission = yield* AccountAdmission.make;
			const scripts = yield* SandboxRepository;
			const entitlements = yield* EntitlementService;
			const calls = yield* ScriptCalls;
			const commands = yield* ChangeSets;

			const dispatch = Effect.fn("OperationsService.dispatch")(function* (input: AdmittedDispatch) {
				const result = yield* calls.run({
					lane: "interactive",
					input: input.payload,
					principal: input.principal,
					executionId: input.executionId,
				});
				if (result.error?.data?.code === "page-write-access-required") {
					return yield* new PluginRequestError({ reason: { code: "page-write-access-required" } });
				}
				if (result.error?.data?.code === "entitlement-required") {
					return yield* entitlementRequired(result.error.data.entitlement);
				}
				if (result.error?.data?.code === "operation-rejected") {
					yield* Effect.annotateCurrentSpan("plugin.rejection", result.error.message);
					return yield* new PluginOperationRejected({ reason: result.error.data.reason });
				}
				if (result.error?.data?.code === "operation-conflict") {
					return yield* new PluginConflictError({
						reason: { code: "changes-conflict", conflict: result.error.data.conflict },
					});
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
				return yield* Schema.decodeUnknownEffect(OperationRunResult)(result.value).pipe(
					Effect.mapError(() => invalidOutput("Sandbox operation result is invalid")),
				);
			});

			const commit = Effect.fn("OperationsService.commit")(function* (
				input: AdmittedDispatch,
				run: typeof OperationRunResult.Type,
			) {
				const { principal, resultIdentity } = input;
				if (run.changes === undefined || isEmptyChangeSet(run.changes)) {
					const receipt: OperationReceipt = { output: run.output, committed: { events: [] } };
					if (resultIdentity) {
						yield* keys.record(resultIdentity, OperationReceipt, receipt);
					}
					return receipt;
				}
				const subject = principal.subject;
				if (subject.type !== "user") {
					return yield* Effect.die("Operation principal must have a user subject");
				}
				const command = yield* operationLifecycleCommand({
					lane: "interactive",
					startedAt: yield* sandboxStartedAt,
					principal: { ...principal, subject },
					executionId: AutomationExecutionId.make(input.executionId),
				}).pipe(Effect.orDie);
				const hook =
					resultIdentity === null
						? undefined
						: {
								finish: (committed: CommittedChanges) =>
									keys.record(resultIdentity, OperationReceipt, { committed, output: run.output }),
								start: keys.lockedRead(resultIdentity, OperationReceipt).pipe(
									Effect.catchTag("IdempotencyConflict", Effect.die),
									Effect.flatMap((stored) =>
										stored ? new ChangeSetAlreadyCommitted() : Effect.void,
									),
								),
							};
				return yield* commands.commit(run.changes, command, hook).pipe(
					Effect.map((committed): OperationReceipt => ({ committed, output: run.output })),
					Effect.catchTag("ChangeSetAlreadyCommitted", () =>
						resultIdentity === null
							? Effect.die("A commit without a receipt cannot be a replay")
							: keys.read(resultIdentity, OperationReceipt).pipe(
									Effect.catchTag("IdempotencyConflict", Effect.die),
									Effect.flatMap((stored) =>
										stored
											? Effect.succeed(stored.response)
											: Effect.die("Replayed receipt vanished"),
									),
								),
					),
					Effect.mapError(commitFailure),
				);
			});

			const invokeInternal = Effect.fn("OperationsService.invokeInternal")(function* (input: {
				readonly resource?: string;
				readonly payload: JsonValue;
				readonly contentHash?: string;
				readonly submittedAt?: string;
				readonly operationSlug: string;
				readonly writeConfirmed?: true;
				readonly idempotencyKey?: string;
				readonly packageId: PluginPackageId;
				readonly pageAuthority?: PageOperationAuthority;
				readonly identity:
					{ readonly userId: UserId } | { readonly headers: PlatformHeaders.Headers };
				readonly sourcePin?: {
					readonly revisionId: string;
					readonly installationId: string;
					readonly configRevisionId: string;
				};
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
					if (
						resolved &&
						input.sourcePin !== undefined &&
						(input.sourcePin.revisionId !== resolved.plugin.pluginRevisionId ||
							input.sourcePin.configRevisionId !== resolved.plugin.pluginConfigRevisionId ||
							input.sourcePin.installationId !== resolved.plugin.installationId)
					) {
						return yield* new PluginConflictError({
							reason: { pluginId: selected.pluginId, code: "source-revision-stale" },
						});
					}
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

				const credential: Effect.Effect<
					Effect.Success<ReturnType<typeof auth.resolveTrustedAccount>>,
					| Effect.Error<ReturnType<typeof auth.resolveTrustedAccount>>
					| Effect.Error<ReturnType<typeof auth.resolveRequestCredential>>
				> = "userId" in input.identity
					? auth.resolveTrustedAccount(input.identity.userId)
					: auth.resolveRequestCredential(new Headers(input.identity.headers), input.resource);
				const authenticated = yield* credential.pipe(
					Effect.map(Result.succeed),
					Effect.catchTag("AuthUnauthorized", (error) => Effect.succeed(Result.fail(error))),
				);
				const pinDispatch = Effect.fn("OperationsService.pinDispatch")(function* (
					dispatchInput: Omit<DispatchInput, "executionId">,
					resolved: NonNullable<Effect.Success<ReturnType<typeof resolveOperation>>>,
				) {
					if (
						input.pageAuthority !== undefined &&
						(Result.isFailure(authenticated) ||
							dispatchInput.userId !== authenticated.success.user.id ||
							dispatchInput.integrationId !== undefined)
					) {
						return yield* new PluginRequestError({
							reason: { code: "page-write-access-required" },
						});
					}
					const executionId = AutomationExecutionId.make(
						`plugin-operation-${sha256Base64Url(
							stableStringify([
								dispatchInput.accountUserId,
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
						pageAuthority: input.pageAuthority ?? null,
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
						executionId: Schema.String,
						principal: ScriptExecutionPrincipal,
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
							principal: existing.response.principal,
							executionId: existing.response.executionId,
						} satisfies AdmittedDispatch;
					}
					const subject = {
						type: "user" as const,
						userId: dispatchInput.userId,
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
					const principal = yield* Schema.decodeEffect(ScriptExecutionPrincipal)({
						...pin,
						subject: {
							...subject,
							...(input.pageAuthority === undefined ? {} : { pageAuthority: input.pageAuthority }),
						},
					}).pipe(Effect.orDie);
					yield* admission.admitAccount(dispatchInput.accountUserId);
					if (input.idempotencyKey !== undefined) {
						yield* keys.record(admissionIdentity, admissionSchema, { principal, executionId });
					}
					return {
						...dispatchInput,
						principal,
						executionId,
						resultIdentity: input.idempotencyKey === undefined ? null : resultIdentity,
					} satisfies AdmittedDispatch;
				});

				const resolveAuthorized = () =>
					Effect.gen(function* () {
						if (input.pageAuthority !== undefined) {
							if (Result.isSuccess(authenticated)) {
								yield* repository.lockIngestionShared([authenticated.success.user.id]);
								yield* database.acquireUserWriteLock(authenticated.success.user.id);
								yield* admission.admitAccount(authenticated.success.user.id);
							}
							if (
								Result.isFailure(authenticated) ||
								!(yield* pageAuthorization.current(
									authenticated.success.user.id,
									input.pageAuthority,
									true,
								))
							) {
								return yield* new PluginRequestError({
									reason: { code: "page-write-access-required" },
								});
							}
						}
						if (Result.isSuccess(authenticated)) {
							const { user, authorization } = authenticated.success;
							const userId = user.id;
							const resolved = yield* resolveOperation(userId);
							if (resolved?.operation.auth === "user") {
								const accessFailure = userOperationAccessFailure({
									operation: resolved.operation,
									pluginScope: resolved.plugin.scope,
									accessClass: authorization.accessClass,
									entitlements: yield* entitlements.current,
								});
								if (accessFailure) {
									return yield* accessFailure;
								}
								if (
									!resolved.operation.hints.readOnly &&
									input.writeConfirmed !== true &&
									authorization.writeAccess !== "unattended"
								) {
									return yield* new WriteAccessDenied({
										reason: { code: "write-access-denied", writeAccess: authorization.writeAccess },
									});
								}
								return yield* pinDispatch(
									{
										userId,
										payload: input.payload,
										accountUserId: user.id,
										scriptId: resolved.script.id,
										operationSlug: input.operationSlug,
										pluginId: PluginId.make(resolved.plugin.id),
									},
									resolved,
								);
							}
							if ("userId" in input.identity) {
								return yield* operationNotFound;
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
										accountUserId:
											user.id === scope.userId
												? user.id
												: yield* admission.currentAccount(scope.userId),
									},
									resolved,
								);
							}
						}

						if ("userId" in input.identity) {
							return yield* Result.isFailure(authenticated)
								? authenticated.failure
								: operationNotFound;
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
								accountUserId: yield* admission.currentAccount(owner.userId),
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
						.read(resultIdentity, OperationReceipt)
						.pipe(Effect.catchTag("IdempotencyConflict", Effect.die));
					if (completed) {
						return completed.response;
					}
				}
				return yield* commit(authorized, yield* dispatch(authorized));
			});

			type Input = Parameters<typeof invokeInternal>[0];
			const invoke = (
				input: Omit<Input, "identity"> & { readonly headers: PlatformHeaders.Headers },
			) => invokeInternal({ ...input, identity: { headers: input.headers } });
			const invokeTrusted = (
				input: { readonly userId: UserId } & Omit<Input, "identity" | "resource" | "pageAuthority">,
			) => invokeInternal({ ...input, identity: { userId: input.userId } });
			return { invoke, invokeTrusted };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
