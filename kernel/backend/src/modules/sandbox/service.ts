import { badRequest, notFound, SandboxRunError } from "@ryot-app/contract/errors";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import type {
	EnqueueSandboxBody,
	SandboxExecutionSubject,
	SandboxExecutionGrants,
} from "@ryot-app/contract/modules/sandbox/schemas";
import { SandboxScriptId, type UserId } from "@ryot-app/contract/schema/brands";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { generateId } from "better-auth";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";
import type { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { AppConfig } from "#lib/infrastructure/config/service";
import type { SandboxPluginRevision } from "#lib/infrastructure/sandbox-runtime/execution-principal";
import { sandboxContextError } from "#lib/infrastructure/sandbox-runtime/limits";
import {
	createWorkflowJobId,
	deriveJobIdSecret,
	resolveWorkflowExecutionId,
} from "#lib/shared/job-id";
import { trimToNull } from "#lib/shared/validation";
import { toWorkflowRunResult } from "#lib/shared/workflow-result";

import { resolveSandboxExecutionPayload } from "./durable-queues";
import { SandboxExecutionResult } from "./execution-result";
import {
	SandboxPluginScriptResolver,
	type SandboxPluginScriptResolverValue,
} from "./plugin-script-resolver";
import { SandboxRepository } from "./repository";
import {
	executeSandboxScriptWorkflow,
	establishSandboxWorkflowPin,
	SandboxScriptWorkflow,
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

			const enqueue = Effect.fn("SandboxExecutionService.enqueue")(function* (
				executingUserId: UserId,
				payload: EnqueueSandboxBody,
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
				const resolvedPayload = yield* resolveSandboxExecutionPayload(
					{
						context,
						executionId,
						scriptId: script.id,
						subject: { type: "user", userId: executingUserId },
					},
					"active",
				).pipe(
					Effect.provideService(SandboxRepository, repository),
					Effect.provideService(SandboxPluginScriptResolver, pluginScriptResolver),
					Effect.catchTag("SandboxRunError", () => notFound(sandboxScriptNotFoundError)),
				);
				yield* engine
					.execute(SandboxScriptWorkflow, {
						executionId,
						discard: true,
						payload: {
							input,
							executionId,
							resultMode: "execution",
							resolutionMode: "exact",
							subject: resolvedPayload.subject,
							scriptId: resolvedPayload.scriptId,
						},
					})
					.pipe(Effect.orDie);

				return {
					executionId,
					jobId: createWorkflowJobId(jobIdSecret, executionId, executingUserId),
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

				const executionId = resolveWorkflowExecutionId(jobIdSecret, executingUserId, resolvedJobId);
				if (!executionId) {
					return yield* notFound(sandboxJobNotFoundError);
				}

				return toSandboxRunResult(
					Option.getOrUndefined(yield* engine.poll(SandboxScriptWorkflow, executionId)),
				);
			});

			const getStoredScript = Effect.fn("SandboxExecutionService.getStoredScript")(function* (
				scriptId: Parameters<typeof repository.getStoredScript>[0],
			) {
				const script = yield* repository.getStoredScript(scriptId);
				if (!script) {
					return yield* notFound(sandboxScriptNotFoundError);
				}
				return script;
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
					return yield* Activity.make({
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
					return yield* engine.execute(SandboxScriptWorkflow, {
						executionId: input.executionId,
						payload: {
							input: input.input,
							subject: input.subject,
							resolutionMode: "exact",
							scriptId: input.scriptId,
							executionId: input.executionId,
							...(input.grants ? { grants: input.grants } : {}),
							...(input.pluginRevision ? { pluginRevision: input.pluginRevision } : {}),
						},
					});
				},
			);

			const executeScript = Effect.fn("SandboxExecutionService.executeScript")(function* (input: {
				input: unknown;
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
						input: scriptInput,
						subject: input.subject,
						resolutionMode: "exact",
						resultMode: "execution",
						scriptId: input.scriptId,
						executionId: input.executionId,
						...(input.grants ? { grants: input.grants } : {}),
					}).pipe(Effect.provideService(WorkflowEngine, engine));
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
				scriptId: SandboxScriptId;
			}) {
				const pin = yield* establishSandboxWorkflowPin(
					{
						input: {},
						resolutionMode: "exact",
						scriptId: input.scriptId,
						executionId: input.executionId,
						subject: { type: "user", userId: input.executingUserId },
					},
					input.executionId,
					input.pluginId,
				).pipe(
					Effect.provideService(SandboxRepository, repository),
					Effect.provideService(SandboxPluginScriptResolver, pluginScriptResolver),
					Effect.provideService(SandboxWorkflowReferenceRepository, workflowReferences),
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
					input: JsonValue;
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
						input: input.input,
						scriptId: script.id,
						executionId: input.executionId,
						resolutionMode: "active" as const,
						subject: { type: "user" as const, userId: input.executingUserId },
					};
					const pin = yield* establishSandboxWorkflowPin(
						payload,
						input.executionId,
						input.pluginId,
					).pipe(
						Effect.provideService(SandboxRepository, repository),
						Effect.provideService(SandboxPluginScriptResolver, pluginScriptResolver),
						Effect.provideService(SandboxWorkflowReferenceRepository, workflowReferences),
					);
					const releaseRegistration =
						pin.registrationStatus === "registered"
							? workflowReferences.release(input.executionId)
							: Effect.void;
					yield* engine
						.execute(SandboxScriptWorkflow, {
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
						})
						.pipe(
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
						Option.getOrUndefined(yield* engine.poll(SandboxScriptWorkflow, executionId)),
					);
				},
			);

			return {
				enqueue,
				getResult,
				executeScript,
				executeWorkflow,
				getStoredScript,
				enqueuePluginWorkflow,
				resolveWorkflowScript,
				getPluginWorkflowResult,
				preRegisterPluginWorkflow,
				releaseWorkflowRegistration,
				listStoredScripts: repository.listStoredScripts(),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
