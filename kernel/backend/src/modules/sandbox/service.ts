import { badRequest, notFound, SandboxRunError } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type {
	EnqueueSandboxBody,
	SandboxExecutionSubject,
	SandboxExecutionGrants,
} from "@ryot-app/contract/modules/sandbox/schemas";
import type { AccountGeneration } from "@ryot-app/contract/schema/account-generation";
import { SandboxScriptId, type UserId } from "@ryot-app/contract/schema/brands";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { generateId } from "better-auth";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import type { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import type {
	SandboxPluginRevision,
	SandboxExecutionPrincipal,
} from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { sandboxContextError } from "#lib/infrastructure/sandbox-runtime/limits";
import { makeActivity } from "#lib/infrastructure/workflow-scope";
import { createWorkflowJobId, deriveJobIdSecret, resolveWorkflowJob } from "#lib/shared/job-id";
import { trimToNull } from "#lib/shared/validation";
import { toWorkflowRunResult } from "#lib/shared/workflow-result";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";

import { SandboxExecutionResult } from "./execution-result";
import {
	SandboxPluginScriptResolver,
	type SandboxPluginScriptResolverValue,
} from "./plugin-script-resolver";
import { SandboxRepository } from "./repository";
import {
	executeSandboxScriptWorkflow,
	SandboxScriptWorkflow,
	SandboxWorkflowPinning,
} from "./sandbox-script-workflow";
import { SandboxWorkflowReferenceRepository } from "./workflow-reference-repository";

const sandboxJobNotFoundError = "Sandbox job not found";
const sandboxScriptNotFoundError = "Sandbox script not found";

const sandboxExecutionFailure = (error: SandboxRunError) => ({
	logs: [],
	value: null,
	status: "completed" as const,
	error: { kind: error.kind, message: error.message, phase: "execute" as const },
});

const toPluginWorkflowResult = (result: Workflow.Result<JsonValue, SandboxRunError> | undefined) =>
	toWorkflowRunResult(result, { onFailure: String, onSuccess: (output) => ({ output }) });

const toSandboxRunResult = (result: Workflow.Result<JsonValue, SandboxRunError> | undefined) =>
	toWorkflowRunResult(result, {
		onFailure: String,
		onSuccess: (value) => {
			const {
				status: _status,
				harvest: _harvest,
				...completed
			} = Schema.decodeUnknownSync(SandboxExecutionResult)(value);
			return completed;
		},
	});

export class SandboxExecutionService extends Context.Service<SandboxExecutionService>()(
	"SandboxExecutionService",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const engine = yield* WorkflowEngine;
			const repository = yield* SandboxRepository;
			const pluginScriptResolver = yield* SandboxPluginScriptResolver;
			const jobIdSecret = deriveJobIdSecret(Redacted.value(config.server.adminAccessToken));
			const workflowReferences = yield* SandboxWorkflowReferenceRepository;
			const pinning = yield* SandboxWorkflowPinning;
			const receipts = yield* MutationReceipts.make;
			const database = yield* DatabaseSession;
			const currentAccount = (userId: UserId) =>
				receipts
					.currentAccount(userId)
					.pipe(
						Effect.mapError(
							(error) => new SandboxRunError({ kind: "infrastructure", message: error.message }),
						),
					);

			const enqueue = Effect.fn("SandboxExecutionService.enqueue")(function* (
				executingUserId: UserId,
				payload: EnqueueSandboxBody,
				lane: ExecutionLane,
			) {
				const scriptId = trimToNull(payload.scriptId);
				if (!scriptId) {
					return yield* notFound(sandboxScriptNotFoundError);
				}
				const context = payload.context ?? {};
				const contextError = sandboxContextError(context);
				if (contextError) {
					return yield* badRequest(contextError);
				}
				const input = yield* Schema.decodeUnknownEffect(jsonValueSchema)(context).pipe(
					Effect.mapError(() => badRequest("Sandbox definition context must be JSON")),
				);
				const script = yield* repository.getScript(payload.scriptId);
				if (!script) {
					return yield* notFound(sandboxScriptNotFoundError);
				}
				const executionId = generateId();
				const resolvedPayload = yield* pinning
					.resolvePayload(
						{
							context,
							executionId,
							scriptId: script.id,
							subject: {
								type: "user",
								userId: executingUserId,
								accountGeneration: yield* currentAccount(executingUserId),
							},
						},
						"active",
					)
					.pipe(Effect.catchTag("SandboxRunError", () => notFound(sandboxScriptNotFoundError)));
				yield* dispatchAdmittedWorkflow(
					receipts,
					engine,
					SandboxScriptWorkflow.forLane(lane),
					resolvedPayload.subject.type === "system"
						? null
						: resolvedPayload.subject.accountGeneration,
					{
						executionId,
						discard: true,
						payload: {
							lane,
							input,
							executionId,
							resultMode: "execution",
							resolutionMode: "exact",
							subject: resolvedPayload.subject,
							scriptId: resolvedPayload.scriptId,
						},
					},
					(admission) => admission.pipe(Effect.orDie),
					(execution) => execution.pipe(Effect.orDie),
				);

				return {
					executionId,
					jobId: createWorkflowJobId(jobIdSecret, { lane, executionId }, executingUserId),
				};
			});

			const getResult = Effect.fn("SandboxExecutionService.getResult")(function* (
				executingUserId: UserId,
				jobId: string,
			) {
				const resolvedJobId = trimToNull(jobId);
				if (!resolvedJobId) {
					return yield* notFound(sandboxJobNotFoundError);
				}

				const job = resolveWorkflowJob(jobIdSecret, executingUserId, resolvedJobId);
				if (!job) {
					return yield* notFound(sandboxJobNotFoundError);
				}

				return toSandboxRunResult(
					Option.getOrUndefined(
						yield* engine.poll(SandboxScriptWorkflow.forLane(job.lane), job.executionId),
					),
				);
			});

			const resolveWorkflowScript = Effect.fn("SandboxExecutionService.resolveWorkflowScript")(
				function* (
					input: {
						userId: UserId;
						pluginId: string;
						executionId: string;
						workflowSlug: string;
						pluginInstallationId: string;
					},
					resolution: ReturnType<
						SandboxPluginScriptResolverValue["findWorkflowScriptAvailableToUser"]
					> = pluginScriptResolver.findWorkflowScriptAvailableToUser(
						input.userId,
						input.pluginId,
						input.workflowSlug,
						input.pluginInstallationId,
					),
				) {
					return yield* makeActivity({
						error: SandboxRunError,
						success: SandboxScriptId,
						name: `resolve-plugin-workflow-${input.executionId}`,
						execute: resolution.pipe(
							Effect.flatMap((script) =>
								script
									? Effect.succeed(script.id)
									: new SandboxRunError({
											kind: "missing-artifact",
											message: `Plugin workflow not found: ${input.pluginId}/${input.workflowSlug}`,
										}),
							),
							Effect.mapError((error) =>
								error instanceof SandboxRunError
									? error
									: new SandboxRunError({ kind: "infrastructure", message: String(error) }),
							),
						),
					});
				},
			);

			const executeWorkflow = Effect.fn("SandboxExecutionService.executeWorkflow")(
				function* (input: {
					input: JsonValue;
					lane: ExecutionLane;
					executionId: string;
					scriptId: SandboxScriptId;
					grants?: SandboxExecutionGrants;
					pluginRevision?: SandboxPluginRevision;
					subject: SandboxExecutionSubject;
				}) {
					const contextError = sandboxContextError(input.input);
					if (contextError) {
						return yield* new SandboxRunError({ message: contextError, kind: "invalid-input" });
					}
					return yield* dispatchAdmittedWorkflow(
						receipts,
						engine,
						SandboxScriptWorkflow.forLane(input.lane),
						input.subject.type === "system" ? null : input.subject.accountGeneration,
						{
							executionId: input.executionId,
							payload: {
								lane: input.lane,
								input: input.input,
								subject: input.subject,
								resolutionMode: "exact",
								scriptId: input.scriptId,
								executionId: input.executionId,
								...(input.grants ? { grants: input.grants } : {}),
								...(input.pluginRevision ? { pluginRevision: input.pluginRevision } : {}),
							},
						},
						(admission) =>
							admission.pipe(
								Effect.mapError(
									(error) =>
										new SandboxRunError({ kind: "infrastructure", message: error.message }),
								),
							),
						(execution) => execution,
					);
				},
			);

			const executeScript = Effect.fn("SandboxExecutionService.executeScript")(function* (input: {
				input: unknown;
				lane: ExecutionLane;
				executionId: string;
				scriptId: SandboxScriptId;
				grants?: SandboxExecutionGrants;
				subject: SandboxExecutionSubject;
			}) {
				return yield* Effect.gen(function* () {
					const contextError = sandboxContextError(input.input);
					if (contextError) {
						return yield* new SandboxRunError({ message: contextError, kind: "invalid-input" });
					}
					const scriptInput = yield* Schema.decodeUnknownEffect(jsonValueSchema)(input.input).pipe(
						Effect.mapError(
							() =>
								new SandboxRunError({
									kind: "invalid-input",
									message: "Sandbox script input must be JSON",
								}),
						),
					);
					return yield* executeSandboxScriptWorkflow({
						lane: input.lane,
						input: scriptInput,
						subject: input.subject,
						resolutionMode: "exact",
						resultMode: "execution",
						scriptId: input.scriptId,
						executionId: input.executionId,
						...(input.grants ? { grants: input.grants } : {}),
					}).pipe(
						Effect.provideService(WorkflowEngine, engine),
						Effect.provideService(DatabaseSession, database),
					);
				}).pipe(
					Effect.catchTag("SandboxRunError", (error) =>
						Effect.succeed(sandboxExecutionFailure(error)),
					),
				);
			});

			const preRegisterPluginWorkflow = Effect.fn(
				"SandboxExecutionService.preRegisterPluginWorkflow",
			)(function* (input: {
				pluginId: string;
				executionId: string;
				executingUserId: UserId;
				accountGeneration: AccountGeneration;
				scriptId: SandboxScriptId;
				retain?: (principal: SandboxExecutionPrincipal) => Effect.Effect<void, SandboxRunError>;
			}) {
				const pin = yield* pinning.establish(
					{
						input: {},
						lane: "background",
						resolutionMode: "exact",
						scriptId: input.scriptId,
						executionId: input.executionId,
						subject: {
							type: "user",
							userId: input.executingUserId,
							accountGeneration: input.accountGeneration,
						},
					},
					input.executionId,
					input.pluginId,
					input.retain,
				);
				if (!pin.principal.pluginRevision) {
					return yield* new SandboxRunError({
						kind: "missing-artifact",
						message: "Sandbox workflow plugin pin not found",
					});
				}
				return { ...pin, pluginRevision: pin.principal.pluginRevision };
			});

			const releaseWorkflowRegistration = (executionId: string) =>
				workflowReferences.release(executionId);

			const enqueuePluginWorkflow = Effect.fn("SandboxExecutionService.enqueuePluginWorkflow")(
				function* (input: {
					accountGeneration: AccountGeneration;
					input: JsonValue;
					lane: ExecutionLane;
					pluginId: string;
					executionId: string;
					workflowSlug: string;
					executingUserId: UserId;
					pluginInstallationId: string;
				}) {
					const contextError = sandboxContextError(input.input);
					if (contextError) {
						return yield* new SandboxRunError({ message: contextError, kind: "invalid-input" });
					}
					const script = yield* pluginScriptResolver.findWorkflowScriptAvailableToUser(
						input.executingUserId,
						input.pluginId,
						input.workflowSlug,
						input.pluginInstallationId,
					);
					if (!script) {
						return yield* notFound(sandboxScriptNotFoundError);
					}
					const payload = {
						lane: input.lane,
						input: input.input,
						scriptId: script.id,
						executionId: input.executionId,
						resolutionMode: "active" as const,
						subject: {
							type: "user" as const,
							userId: input.executingUserId,
							accountGeneration: input.accountGeneration,
						},
					};
					const pin = yield* pinning.establish(payload, input.executionId, input.pluginId);
					const releaseRegistration =
						pin.registrationStatus === "registered"
							? workflowReferences.release(input.executionId)
							: Effect.void;
					yield* dispatchAdmittedWorkflow(
						receipts,
						engine,
						SandboxScriptWorkflow.forLane(input.lane),
						input.accountGeneration,
						{
							discard: true,
							executionId: input.executionId,
							payload: {
								...payload,
								resolutionMode: "exact",
								scriptId: pin.principal.scriptId,
								...(pin.principal.pluginRevision
									? { pluginRevision: pin.principal.pluginRevision }
									: {}),
							},
						},
						(admission) => admission,
						(dispatch) => dispatch,
					).pipe(
						Effect.matchCauseEffect({
							onSuccess: Effect.succeed,
							onFailure: (cause) =>
								releaseRegistration.pipe(Effect.andThen(Effect.failCause(cause))),
						}),
						Effect.orDie,
					);
					return input.executionId;
				},
			);

			const getPluginWorkflowResult = Effect.fn("SandboxExecutionService.getPluginWorkflowResult")(
				function* (executionId: string) {
					return toPluginWorkflowResult(
						Option.getOrUndefined(
							yield* engine.poll(SandboxScriptWorkflow.background, executionId),
						),
					);
				},
			);

			return {
				enqueue,
				getResult,
				executeScript,
				executeWorkflow,
				enqueuePluginWorkflow,
				resolveWorkflowScript,
				getPluginWorkflowResult,
				preRegisterPluginWorkflow,
				releaseWorkflowRegistration,
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
