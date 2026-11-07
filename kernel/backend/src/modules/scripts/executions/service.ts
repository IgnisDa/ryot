import { badRequest, notFound, SandboxRunError } from "@ryot-app/contract/errors";
import type { ExecutionLane } from "@ryot-app/contract/modules/automations/lifecycle";
import {
	type EnqueueSandboxBody,
	type SandboxExecutionGrants,
	type SandboxExecutionSubject,
	sandboxSubjectUserId,
} from "@ryot-app/contract/modules/scripts/schemas";
import { SandboxScriptId, type UserId } from "@ryot-app/contract/schema/brands";
import type { JsonValue } from "@ryot-app/contract/schema/json";
import { jsonValueSchema } from "@ryot-app/plugin-backend-sdk/wire";
import { sandboxContextError } from "@ryot-app/sandbox/protocol/limits";
import { generateId } from "better-auth";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Workflow } from "effect/workflow";
import { WorkflowEngine } from "effect/workflow/WorkflowEngine";

import { AccountAdmission } from "#modules/mutations/account-admission";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import type {
	ScriptExecutionPrincipal,
	ScriptInstallationInitialization,
	ScriptPluginRevision,
} from "#modules/scripts/authorization/principal";
import { AppConfig } from "#platform/config/service";
import { DatabaseSession } from "#platform/db/session";
import { trimToNull } from "#platform/validation";
import {
	createWorkflowJobId,
	deriveJobIdSecret,
	resolveWorkflowJob,
} from "#platform/workflow/job-id";
import { toWorkflowRunResult } from "#platform/workflow/result";
import { makeActivity } from "#platform/workflow/scope";

import {
	SandboxPluginScriptResolver,
	type SandboxPluginScriptResolverValue,
} from "../registry/plugin-script-resolver";
import { SandboxRepository } from "../registry/repository";
import { SandboxWorkflowReferenceRepository } from "../registry/workflow-references";
import type { SandboxAdmission } from "./queues";
import { SandboxExecutionResult } from "./result";
import type { DirectScriptExecutor } from "./workflow";
import {
	executeScriptExecutionWorkflow,
	SandboxWorkflowPinning,
	ScriptExecutionWorkflow,
} from "./workflow";

const sandboxJobNotFoundError = "Sandbox job not found";
const sandboxScriptNotFoundError = "Sandbox script not found";

const sandboxExecutionFailure = (error: SandboxRunError) => ({
	logs: [],
	value: null,
	status: "completed" as const,
	error: {
		kind: error.kind,
		message: error.message,
		phase: "execute" as const,
		...(error.data === undefined ? {} : { data: error.data }),
	},
});

const toPluginWorkflowResult = (result: undefined | Workflow.Result<JsonValue, SandboxRunError>) =>
	toWorkflowRunResult(result, { onFailure: String, onSuccess: (output) => ({ output }) });

const decodeSandboxExecutionResult = Schema.decodeUnknownEffect(SandboxExecutionResult);

const toSandboxRunResult = Effect.fnUntraced(function* (
	result: undefined | Workflow.Result<JsonValue, SandboxRunError>,
) {
	const decoded =
		result?._tag === "Complete"
			? new Workflow.Complete({
					exit: yield* Effect.exit(
						Effect.flatMap(result.exit, (value) =>
							decodeSandboxExecutionResult(value).pipe(Effect.orDie),
						),
					),
				})
			: result;
	return toWorkflowRunResult(decoded, {
		onFailure: String,
		onSuccess: ({ status: _status, harvest: _harvest, ...completed }) => completed,
	});
});

export type ScriptExecutionInput = {
	input: unknown;
	lane: ExecutionLane;
	executionId: string;
	scriptId: SandboxScriptId;
	grants?: SandboxExecutionGrants;
	subject: SandboxExecutionSubject;
	pluginRevision?: ScriptPluginRevision;
	initialization?: ScriptInstallationInitialization;
};

const scriptExecutionPayload = Effect.fnUntraced(function* (input: ScriptExecutionInput) {
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
	return {
		lane: input.lane,
		input: scriptInput,
		subject: input.subject,
		scriptId: input.scriptId,
		executionId: input.executionId,
		resolutionMode: "exact" as const,
		resultMode: "execution" as const,
		...(input.grants ? { grants: input.grants } : {}),
		...(input.pluginRevision ? { pluginRevision: input.pluginRevision } : {}),
		...(input.initialization ? { initialization: input.initialization } : {}),
	};
});

/** Runs a script once without a workflow; see `DirectScriptExecutor` for which scripts may. */
export const executeScriptDirectly = (
	executor: DirectScriptExecutor["Service"],
	input: ScriptExecutionInput,
	admission: SandboxAdmission,
) =>
	scriptExecutionPayload(input).pipe(
		Effect.flatMap((payload) => executor.execute(payload, input.executionId, admission)),
		Effect.catchTag("SandboxRunError", (error) => Effect.succeed(sandboxExecutionFailure(error))),
	);

export class ScriptExecutionService extends Context.Service<ScriptExecutionService>()(
	"@ryot-app/kernel-backend/modules/scripts/executions/service/ScriptExecutionService",
	{
		make: Effect.gen(function* () {
			const config = yield* AppConfig;
			const engine = yield* WorkflowEngine;
			const repository = yield* SandboxRepository;
			const pluginScriptResolver = yield* SandboxPluginScriptResolver;
			const jobIdSecret = deriveJobIdSecret(Redacted.value(config.server.adminAccessToken));
			const workflowReferences = yield* SandboxWorkflowReferenceRepository;
			const pinning = yield* SandboxWorkflowPinning;
			const admission = yield* AccountAdmission.make;
			const database = yield* DatabaseSession;
			const currentAccount = (userId: UserId) =>
				admission
					.currentAccount(userId)
					.pipe(
						Effect.mapError(
							(error) => new SandboxRunError({ kind: "infrastructure", message: error.message }),
						),
					);

			const enqueue = Effect.fn("ScriptExecutionService.enqueue")(function* (
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
							subject: { type: "user", userId: yield* currentAccount(executingUserId) },
						},
						"active",
					)
					.pipe(Effect.catchTag("SandboxRunError", () => notFound(sandboxScriptNotFoundError)));
				yield* dispatchAdmittedWorkflow(
					engine,
					ScriptExecutionWorkflow,
					sandboxSubjectUserId(resolvedPayload.subject),
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
				).pipe(Effect.orDie);

				return {
					executionId,
					jobId: createWorkflowJobId(jobIdSecret, { executionId }, executingUserId),
				};
			});

			const getResult = Effect.fn("ScriptExecutionService.getResult")(function* (
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

				return yield* toSandboxRunResult(
					Option.getOrUndefined(yield* engine.poll(ScriptExecutionWorkflow, job.executionId)),
				);
			});

			const resolveWorkflowScript = Effect.fn("ScriptExecutionService.resolveWorkflowScript")(
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

			const executeWorkflow = Effect.fn("ScriptExecutionService.executeWorkflow")(
				function* (input: {
					input: JsonValue;
					lane: ExecutionLane;
					executionId: string;
					scriptId: SandboxScriptId;
					grants?: SandboxExecutionGrants;
					subject: SandboxExecutionSubject;
					pluginRevision?: ScriptPluginRevision;
				}) {
					const contextError = sandboxContextError(input.input);
					if (contextError) {
						return yield* new SandboxRunError({ message: contextError, kind: "invalid-input" });
					}
					return yield* dispatchAdmittedWorkflow(
						engine,
						ScriptExecutionWorkflow,
						sandboxSubjectUserId(input.subject),
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
					).pipe(
						Effect.catchTag("DbError", (error) =>
							Effect.fail(new SandboxRunError({ kind: "infrastructure", message: error.message })),
						),
					);
				},
			);

			const executeScript = Effect.fn("ScriptExecutionService.executeScript")(function* (
				input: ScriptExecutionInput,
			) {
				return yield* scriptExecutionPayload(input).pipe(
					Effect.flatMap((payload) =>
						executeScriptExecutionWorkflow(payload).pipe(
							Effect.provideService(WorkflowEngine, engine),
							Effect.provideService(DatabaseSession, database),
						),
					),
					Effect.catchTag("SandboxRunError", (error) =>
						Effect.succeed(sandboxExecutionFailure(error)),
					),
				);
			});

			const preRegisterPluginWorkflow = Effect.fn(
				"ScriptExecutionService.preRegisterPluginWorkflow",
			)(function* (input: {
				pluginId: string;
				executionId: string;
				accountUserId: UserId;
				executingUserId: UserId;
				scriptId: SandboxScriptId;
				retain?: (principal: ScriptExecutionPrincipal) => Effect.Effect<void, SandboxRunError>;
			}) {
				const pin = yield* pinning.establish(
					{
						input: {},
						lane: "background",
						resolutionMode: "exact",
						scriptId: input.scriptId,
						executionId: input.executionId,
						subject: { type: "user", userId: input.executingUserId },
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

			const enqueuePluginWorkflow = Effect.fn("ScriptExecutionService.enqueuePluginWorkflow")(
				function* (input: {
					input: JsonValue;
					pluginId: string;
					lane: ExecutionLane;
					executionId: string;
					workflowSlug: string;
					accountUserId: UserId;
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
						subject: { type: "user" as const, userId: input.executingUserId },
					};
					const pin = yield* pinning.establish(payload, input.executionId, input.pluginId);
					const releaseRegistration =
						pin.registrationStatus === "registered"
							? workflowReferences.release(input.executionId)
							: Effect.void;
					yield* dispatchAdmittedWorkflow(engine, ScriptExecutionWorkflow, input.accountUserId, {
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
					}).pipe(
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

			const getPluginWorkflowResult = Effect.fn("ScriptExecutionService.getPluginWorkflowResult")(
				function* (executionId: string) {
					return toPluginWorkflowResult(
						Option.getOrUndefined(yield* engine.poll(ScriptExecutionWorkflow, executionId)),
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
