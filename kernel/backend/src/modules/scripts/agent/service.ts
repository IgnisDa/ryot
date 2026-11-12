import { BadRequest, SandboxRunError } from "@ryot-app/contract/errors";
import { SandboxCompilationFailure } from "@ryot-app/contract/modules/scripts/schemas";
import { isSandboxHostCapability } from "@ryot-app/contract/modules/scripts/wire";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { SandboxScriptId } from "@ryot-app/contract/schema/brands";
import { JsonValue } from "@ryot-app/contract/schema/json";
import { utf8ByteLength } from "@ryot-app/plugin-backend-compiler/limits";
import { sandboxHostContracts } from "@ryot-app/plugin-backend-sdk/core";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";
import {
	workflowReplayEnvelopeSchema,
	type WorkflowReplayJournalEntry,
} from "@ryot-app/plugin-backend-sdk/workflow/protocol";
import { decodeSandboxHostArguments } from "@ryot-app/sandbox/host/bridge-adapter";
import { SandboxExecutor } from "@ryot-app/sandbox/host/executor";
import {
	chunkSandboxJournalEntry,
	type SandboxPinnedJournal,
} from "@ryot-app/sandbox/host/pinned-journal";
import { SANDBOX_LIMITS, sandboxWorkflowJournalByteError } from "@ryot-app/sandbox/protocol/limits";
import { sha256Hex } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { generateId } from "better-auth";
import { Clock, Context, DateTime, Effect, Layer, Schema } from "effect";

import { AgentToolResult, truncateJsonResult } from "#platform/tool-result";

import { isSandboxCapabilityAllowed } from "../authorization/capabilities";
import type { ScriptExecutionPrincipal } from "../authorization/principal";
import { validateWorkflowReplayEnvelope } from "../executions/workflow";
import { SandboxCompiler } from "../registry/compiler";
import { AgentScriptRepository } from "./repository";

const failure = (message: string) => new SandboxRunError({ message, kind: "script-failure" });

const pinnedJournal = (entries: readonly WorkflowReplayJournalEntry[]): SandboxPinnedJournal => {
	const chunks = entries.map((entry) => chunkSandboxJournalEntry(stableStringify(entry)));
	return {
		fault: () => undefined,
		entries: chunks.map((entry) => entry.pin),
		readChunk: (index, chunk) => Effect.succeed(chunks[index]?.chunks[chunk] ?? null),
		bytes:
			2 + Math.max(0, chunks.length - 1) + chunks.reduce((sum, entry) => sum + entry.pin[0], 0),
	};
};

export class AgentScriptService extends Context.Service<AgentScriptService>()(
	"@ryot-app/kernel-backend/modules/scripts/agent/service/AgentScriptService",
	{
		make: Effect.gen(function* () {
			const compiler = yield* SandboxCompiler;
			const executor = yield* SandboxExecutor;
			const repository = yield* AgentScriptRepository;
			const run = Effect.fn("AgentScriptService.run")(function* (input: {
				readonly userId: UserId;
				readonly source: string;
				readonly allowWrites: boolean;
				readonly idempotencyKey?: string;
				readonly accessClass: "demo" | "standard";
				readonly executeRyotql: (request: JsonValue) => Effect.Effect<JsonValue, SandboxHostError>;
				readonly invokeOperation: (
					request: { readonly name: string; readonly arguments: JsonValue },
					key: string,
				) => Effect.Effect<JsonValue, SandboxHostError>;
			}) {
				if (input.accessClass === "demo" && input.allowWrites) {
					return yield* new BadRequest({ message: "Demo sessions cannot approve agent writes" });
				}
				if (utf8ByteLength(input.source) > SANDBOX_LIMITS.compiler.sourceBytes) {
					return yield* new BadRequest({
						message: "Agent script exceeds the sandbox source byte limit",
					});
				}
				const id = SandboxScriptId.make(
					`agent-${sha256Hex(stableStringify([input.userId, input.idempotencyKey ?? generateId()]))}`,
				);
				const created = yield* repository.create({
					id,
					userId: input.userId,
					source: input.source,
					allowWrites: input.allowWrites,
				});
				if (!created) {
					const existing = yield* repository.find(input.userId, id);
					if (
						!existing ||
						existing.source !== input.source ||
						existing.allowWrites !== input.allowWrites ||
						(existing.principal?.subject.type === "agent" &&
							existing.principal.subject.accessClass !== input.accessClass)
					) {
						return yield* new BadRequest({
							message: "Agent execution key was reused with different input or authority",
						});
					}
					if (existing.result !== null) {
						return yield* Schema.decodeUnknownEffect(AgentToolResult)(existing.result).pipe(
							Effect.orDie,
						);
					}
					return yield* new BadRequest({
						message:
							"Agent execution is already running or was interrupted; it cannot be restarted",
					});
				}
				const execute = Effect.gen(function* () {
					const compiled = yield* compiler.compile(input.source);
					if (compiled.manifest.kind !== "script") {
						return yield* failure("Agent source must define a script");
					}
					const principal: ScriptExecutionPrincipal = {
						scriptId: id,
						providerId: null,
						pluginRevision: null,
						metadata: compiled.manifest,
						scriptSlug: compiled.manifest.slug,
						contentHash: sha256Hex(compiled.javascript),
						subject: {
							type: "agent",
							userId: input.userId,
							allowWrites: input.allowWrites,
							accessClass: input.accessClass,
						},
					};
					for (const capability of compiled.manifest.capabilities) {
						if (
							!isSandboxHostCapability(capability) ||
							!isSandboxCapabilityAllowed({ principal }, capability)
						) {
							return yield* failure(`Agent capability is not permitted: ${capability}`);
						}
					}
					yield* repository.pin(input.userId, id, principal);
					const startedAt = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
					const journal: WorkflowReplayJournalEntry[] = [];
					let journalBytes = 2;
					for (let round = 0; round <= SANDBOX_LIMITS.hostCalls.total; round += 1) {
						const replayJournal = pinnedJournal(journal);

						const result = yield* executor.run({
							principal,
							startedAt,
							context: {},
							replayJournal,
							lane: "interactive",
							workflowExecutionId: id,
							executionId: `${id}-${round}`,
							compiledFormat: compiled.format,
							compiledCode: compiled.javascript,
						});
						if (result.recovery !== undefined) {
							yield* executor.completeRecovery(result.recovery);
						}
						const logs: string[] = [];
						let logBytes = 0;
						for (const log of result.logs) {
							const bytes = new TextEncoder().encode(log).length;
							if (
								logs.length < SANDBOX_LIMITS.logs.entryCount &&
								logBytes + bytes <= SANDBOX_LIMITS.logs.totalBytes
							) {
								logs.push(log);
								logBytes += bytes;
							}
						}
						if (!result.success) {
							return { logs, value: null, executionId: id, error: result.error };
						}
						const envelope = yield* Schema.decodeUnknownEffect(workflowReplayEnvelopeSchema)(
							result.value,
						).pipe(Effect.mapError(() => failure("Invalid agent execution result")));
						yield* validateWorkflowReplayEnvelope(envelope, journal, []);
						if (envelope.state === "completed") {
							return { logs, error: null, executionId: id, value: envelope.output };
						}
						if (envelope.state === "failed") {
							return {
								logs,
								value: null,
								executionId: id,
								error: { kind: envelope.kind, message: envelope.error },
							};
						}
						if (envelope.state !== "pending" || envelope.requests.length <= journal.length) {
							return yield* failure("Agent scripts cannot checkpoint");
						}
						for (const request of envelope.requests.slice(journal.length)) {
							if (
								request.index !== journal.length ||
								request.kind !== "host" ||
								request.name !== request.args.capability ||
								!isSandboxCapabilityAllowed({ principal }, request.args.capability)
							) {
								return yield* failure("Invalid agent host call identity");
							}
							let call: Effect.Effect<JsonValue, SandboxHostError>;
							if (request.args.capability === "executeRyotql") {
								yield* decodeSandboxHostArguments(
									"executeRyotql",
									sandboxHostContracts.executeRyotql,
								)(request.args.args);
								const value = request.args.args[0];
								if (value === undefined) {
									return yield* failure("Missing agent query");
								}
								call = input.executeRyotql(value);
							} else if (request.args.capability === "invokeOperation") {
								const [operation] = yield* decodeSandboxHostArguments(
									"invokeOperation",
									sandboxHostContracts.invokeOperation,
								)(request.args.args);
								call = input.invokeOperation(operation, `${id}:${request.index}`);
							} else {
								return yield* failure(
									`Agent host call is not permitted: ${request.args.capability}`,
								);
							}
							const receipt = yield* call.pipe(
								Effect.match({
									onSuccess: (value) => ({ value, state: "success" as const }),
									onFailure: (error) => ({
										state: "failure" as const,
										error: {
											message: error.message,
											...(error.data === undefined ? {} : { data: error.data }),
										},
									}),
								}),
							);
							const entry = { request, value: receipt };
							const bytes = utf8ByteLength(stableStringify(entry));
							const budgetError = sandboxWorkflowJournalByteError(
								journalBytes,
								bytes,
								journal.length,
							);
							if (budgetError !== null) {
								return yield* failure(budgetError);
							}
							journalBytes += bytes + (journal.length === 0 ? 0 : 1);
							journal.push(entry);
						}
					}
					return yield* failure("Agent host call limit exceeded");
				});
				const raw = yield* execute.pipe(
					Effect.timeout(SANDBOX_LIMITS.execution.timeoutMs),
					Effect.catch((error) =>
						Effect.succeed(
							error instanceof SandboxCompilationFailure
								? { logs: [], value: null, executionId: id, diagnostics: error.diagnostics }
								: { logs: [], value: null, executionId: id, error: { message: error.message } },
						),
					),
				);
				const json = yield* Schema.decodeUnknownEffect(JsonValue)(raw).pipe(Effect.orDie);
				const bounded = truncateJsonResult(json);
				yield* repository.complete(input.userId, id, bounded);
				return bounded;
			});
			return { run };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
