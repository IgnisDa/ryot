import { badRequest, notFound, SandboxRunError } from "@ryot/contract/errors";
import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
import type {
	EnqueueSandboxBody,
	ExecutionAuthority,
	SandboxExecutionGrants,
} from "@ryot/contract/modules/sandbox/schemas";
import { SandboxScriptId, type UserId } from "@ryot/contract/schema/brands";
import { jsonValueSchema } from "@ryot/sandbox-sdk/wire";
import { generateId } from "better-auth";
import { Context, Effect, Layer, Option, Redacted, Schema } from "effect";
import { Activity } from "effect/unstable/workflow";
import type { Workflow } from "effect/unstable/workflow";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DbRunner, TransactionRunner } from "#lib/infrastructure/db/service";
import { sandboxContextError } from "#lib/infrastructure/sandbox-runtime/limits";
import { createWorkflowJobId, resolveWorkflowExecutionId } from "#lib/shared/job-id";
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
	error: { phase: "execute" as const, message: error.message },
});

const toPluginWorkflowResult = (result: Workflow.Result<JsonValue, SandboxRunError> | undefined) =>
	toWorkflowRunResult(result, {
		onFailure: String,
		onSuccess: (output) => ({ output }),
	});

const toSandboxRunResult = (result: Workflow.Result<JsonValue, SandboxRunError> | undefined) =>
	toWorkflowRunResult(result, {
		onFailure: String,
		onSuccess: (value) => {
			const {
				harvest: _harvest,
				status: _status,
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
			const runWithDb = yield* DbRunner;
			const engine = yield* WorkflowEngine;
			const repository = yield* SandboxRepository;
			const runInTransaction = yield* TransactionRunner;
			const pluginScriptResolver = yield* SandboxPluginScriptResolver;
			const jobIdSecret = Redacted.value(config.sandbox.jobIdSecret);
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
				const script = yield* runWithDb(repository.getScript(payload.scriptId));
				if (!script) {
					return yield* notFound(sandboxScriptNotFoundError);
				}
				const executionId = generateId();
				const resolvedPayload = yield* resolveSandboxExecutionPayload(
					{
						context,
						authority: { type: "user", userId: executingUserId },
						executionId,
						scriptId: script.id,
					},
					"active",
				).pipe(
					Effect.provideService(DbRunner, runWithDb),
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
							scriptId: resolvedPayload.scriptId,
							authority: resolvedPayload.authority,
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
				const script = yield* runWithDb(repository.getStoredScript(scriptId));
				if (!script) {
					return yield* notFound(sandboxScriptNotFoundError);
				}
				return script;
			});

			const resolveWorkflowScript = Effect.fn("SandboxExecutionService.resolveWorkflowScript")(
				function* (
					input: { pluginSlug: string; workflowSlug: string; executionId: string },
					resolution: ReturnType<
						SandboxPluginScriptResolverValue["findActiveWorkflowScript"]
					> = pluginScriptResolver.findActiveWorkflowScript({
						pluginSlug: input.pluginSlug,
						workflowSlug: input.workflowSlug,
					}),
				) {
					return yield* Activity.make({
						error: SandboxRunError,
						success: SandboxScriptId,
						name: `resolve-plugin-workflow-${input.executionId}`,
						execute: runWithDb(resolution).pipe(
							Effect.flatMap((script) =>
								script
									? Effect.succeed(script.id)
									: new SandboxRunError({
											message: `Plugin workflow not found: ${input.pluginSlug}/${input.workflowSlug}`,
										}),
							),
							Effect.mapError((error) =>
								error instanceof SandboxRunError
									? error
									: new SandboxRunError({ message: String(error) }),
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
					authority: ExecutionAuthority;
					grants?: SandboxExecutionGrants;
				}) {
					const contextError = sandboxContextError(input.input);
					if (contextError) {
						return yield* new SandboxRunError({ message: contextError });
					}
					return yield* engine.execute(SandboxScriptWorkflow, {
						executionId: input.executionId,
						payload: {
							input: input.input,
							resolutionMode: "exact",
							scriptId: input.scriptId,
							authority: input.authority,
							executionId: input.executionId,
							...(input.grants ? { grants: input.grants } : {}),
						},
					});
				},
			);

			const executeScript = Effect.fn("SandboxExecutionService.executeScript")(function* (input: {
				input: unknown;
				executionId: string;
				scriptId: SandboxScriptId;
				authority: ExecutionAuthority;
				grants?: SandboxExecutionGrants;
			}) {
				return yield* Effect.gen(function* () {
					const contextError = sandboxContextError(input.input);
					if (contextError) {
						return yield* new SandboxRunError({ message: contextError });
					}
					const scriptInput = yield* Schema.decodeUnknownEffect(jsonValueSchema)(input.input).pipe(
						Effect.mapError(
							() => new SandboxRunError({ message: "Sandbox script input must be JSON" }),
						),
					);
					return yield* executeSandboxScriptWorkflow({
						input: scriptInput,
						resolutionMode: "exact",
						resultMode: "execution",
						scriptId: input.scriptId,
						authority: input.authority,
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
				pluginSlug: string;
				executionId: string;
				executingUserId: UserId;
				scriptId: SandboxScriptId;
			}) {
				return yield* establishSandboxWorkflowPin(
					{
						input: {},
						resolutionMode: "exact",
						scriptId: input.scriptId,
						executionId: input.executionId,
						authority: { type: "user", userId: input.executingUserId },
					},
					input.executionId,
					input.pluginSlug,
				).pipe(
					Effect.provideService(DbRunner, runWithDb),
					Effect.provideService(SandboxRepository, repository),
					Effect.provideService(TransactionRunner, runInTransaction),
					Effect.provideService(SandboxPluginScriptResolver, pluginScriptResolver),
					Effect.provideService(SandboxWorkflowReferenceRepository, workflowReferences),
				);
			});

			const releaseWorkflowRegistration = (executionId: string) =>
				runWithDb(workflowReferences.release(executionId));

			const enqueuePluginWorkflow = Effect.fn("SandboxExecutionService.enqueuePluginWorkflow")(
				function* (input: {
					input: JsonValue;
					pluginSlug: string;
					executionId: string;
					workflowSlug: string;
					executingUserId: UserId;
				}) {
					const contextError = sandboxContextError(input.input);
					if (contextError) {
						return yield* new SandboxRunError({ message: contextError });
					}
					const script = yield* runWithDb(
						pluginScriptResolver.findActiveWorkflowScript({
							pluginSlug: input.pluginSlug,
							workflowSlug: input.workflowSlug,
						}),
					);
					if (!script) {
						return yield* notFound(sandboxScriptNotFoundError);
					}
					const payload = {
						input: input.input,
						scriptId: script.id,
						executionId: input.executionId,
						resolutionMode: "active" as const,
						authority: { type: "user" as const, userId: input.executingUserId },
					};
					const pin = yield* establishSandboxWorkflowPin(payload, input.executionId).pipe(
						Effect.provideService(DbRunner, runWithDb),
						Effect.provideService(SandboxRepository, repository),
						Effect.provideService(TransactionRunner, runInTransaction),
						Effect.provideService(SandboxPluginScriptResolver, pluginScriptResolver),
						Effect.provideService(SandboxWorkflowReferenceRepository, workflowReferences),
					);
					const releaseRegistration =
						pin.registrationStatus === "registered"
							? runWithDb(workflowReferences.release(input.executionId))
							: Effect.void;
					yield* engine
						.execute(SandboxScriptWorkflow, {
							discard: true,
							executionId: input.executionId,
							payload: { ...payload, scriptId: pin.scriptId, resolutionMode: "exact" },
						})
						.pipe(
							Effect.matchCauseEffect({
								onFailure: (cause) =>
									releaseRegistration.pipe(Effect.andThen(Effect.failCause(cause))),
								onSuccess: Effect.succeed,
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
				listStoredScripts: runWithDb(repository.listStoredScripts()),
			};
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
