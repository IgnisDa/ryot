import type {
	IngestionActivity,
	IngestionBatch,
	IngestionScope,
} from "@ryot-app/contract/modules/imports/ingestion";
import type { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import { ImportRunId, UserId, IntegrationId } from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import {
	integrationConfirmationWorkflowInputSchema,
	integrationConfirmationWorkflowResultSchema,
	genericImportChunkSchema,
} from "@ryot-app/sandbox-sdk/imports";
import { jsonValueSchema } from "@ryot-app/sandbox-sdk/wire";
import { sha256Base64Url } from "@ryot-app/ts-utils/crypto";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Data, DateTime, Effect, Exit, Layer, Schema } from "effect";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import {
	genericIngestionBatchResult,
	reconcileGenericIngestionBatch,
} from "#modules/imports/batch-results";
import { IngestionCaptures } from "#modules/imports/capture-service";
import { reconcileDataIngestionBatch } from "#modules/imports/data-workflow";
import { IngestionExecution } from "#modules/imports/execution-service";
import { ImportsRepository } from "#modules/imports/repository";
import type { IngestionRecoveryCursor } from "#modules/imports/runtime/recovery-cursor";
import { ImportSourceStateStore } from "#modules/imports/runtime/source-state-store";
import { ImportRunError } from "#modules/imports/runtime/workflow-errors";
import { ImportWorkflowPinning } from "#modules/imports/workflow-pinning";
import { MutationReceipts } from "#modules/mutations/receipts";
import { IngestionReadinessService } from "#modules/plugins/ingestion-readiness-service";
import { SandboxPluginScriptResolver } from "#modules/sandbox/plugin-script-resolver";
import { SandboxExecutionService } from "#modules/sandbox/service";

import type { IntegrationWebhookDelivery } from "./jobs";
import type { IntegrationRecord } from "./repository";

export class IntegrationConfirmationError extends Data.TaggedError("IntegrationConfirmationError")<{
	readonly message: string;
}> {}

export class IntegrationIngestion extends Context.Service<IntegrationIngestion>()(
	"IntegrationIngestion",
	{
		make: Effect.gen(function* () {
			const repository = yield* ImportsRepository;
			const database = yield* DatabaseSession;
			const receipts = yield* MutationReceipts.make;
			const readiness = yield* IngestionReadinessService;
			const scripts = yield* SandboxPluginScriptResolver;
			const pinning = yield* ImportWorkflowPinning;
			const states = yield* ImportSourceStateStore;
			const execution = yield* IngestionExecution;
			const captures = yield* IngestionCaptures;
			const sandbox = yield* SandboxExecutionService;
			const inputReady = Effect.fn("IntegrationIngestion.inputReady")(function* (
				scope: IngestionScope,
			) {
				const input = yield* repository.getIntegrationInput(scope);
				return (
					input?.lot === "yank" ||
					(input?.lot === "sink" &&
						input.envelope?.state === "sealed" &&
						input.envelope.payload !== null)
				);
			});
			const admittedContext = Effect.fn("IntegrationIngestion.admittedContext")(function* (
				scope: IngestionScope,
			) {
				const input = yield* repository.getIntegrationInput(scope);
				if (input?.lot === "yank") {
					return {};
				}
				if (
					input?.lot !== "sink" ||
					input.envelope?.state !== "sealed" ||
					input.envelope.payload === null
				) {
					return yield* new ImportRunError({
						message: "Integration admitted envelope is not sealed",
					});
				}
				return yield* states.loadEnvelope(scope);
			});
			const confirm = Effect.fn("IntegrationIngestion.confirm")(function* (
				scope: IngestionScope,
				batch: IngestionBatch,
			) {
				const run = yield* repository.getIngestionRun(scope);
				if (!run?.pins || !run.plan || run.pluginInstallationId === null) {
					return yield* Effect.void;
				}
				const chunk = yield* Schema.decodeEffect(Schema.fromJsonString(genericImportChunkSchema))(
					new TextDecoder().decode(yield* captures.read(scope, batch.captureId, 4 * 1024 * 1024)),
				);
				const result = yield* genericIngestionBatchResult(scope, batch, chunk).pipe(
					Effect.provideService(ImportsRepository, repository),
				);
				if (!result.confirmed.length) {
					return yield* Effect.void;
				}
				const state = yield* states.materialize(scope);
				const integrationContext = yield* admittedContext(scope);
				if (
					state.workflowScriptId !== run.pins.scriptId ||
					state.pluginRevision.revisionId !== run.pins.pluginRevisionId ||
					state.pluginRevision.configRevisionId !== run.pins.pluginConfigRevisionId
				) {
					return yield* new ImportRunError({
						message: "Integration confirmation does not match its retained pins",
					});
				}
				for (let start = 0, part = 0; start < result.confirmed.length; part++) {
					let end = start;
					let bytes = 2;
					while (end < result.confirmed.length) {
						const size =
							new TextEncoder().encode(stableStringify(result.confirmed[end])).length + 1;
						if (size > 32 * 1024) {
							return yield* new ImportRunError({
								message: "Integration confirmation operation exceeds its byte limit",
							});
						}
						if (end > start && bytes + size > 32 * 1024) {
							break;
						}
						bytes += size;
						end++;
					}
					const identity = sha256Base64Url(
						stableStringify([scope.runId, batch.id, batch.inputFingerprint, part]),
					);
					const id = `source-confirmation:${identity}`;
					const previous = (yield* repository.getIngestionRun(scope))?.activities.find(
						(activity) => activity.id === id,
					);
					if (previous?.state === "completed") {
						start = end;
						continue;
					}
					const attempt = previous?.completed ?? 0;
					const activity: IngestionActivity = {
						id,
						wait: null,
						parentId: null,
						exactTotal: null,
						state: "running",
						batchId: batch.id,
						kind: "finishing",
						completed: attempt,
						unit: "confirmation-attempts",
						lastAdvancedAt: (yield* DateTime.nowAsDate).toISOString(),
					};
					yield* database.transaction(repository.putSettlementActivity(scope, activity));
					const input = yield* Schema.encodeEffect(integrationConfirmationWorkflowInputSchema)({
						plan: run.plan,
						integrationContext,
						ingestionConfirmation: {
							part,
							batchId: batch.id,
							runId: scope.runId,
							final: end === result.confirmed.length,
							inputFingerprint: batch.inputFingerprint,
							confirmed: result.confirmed.slice(start, end),
						},
					}).pipe(Effect.flatMap(Schema.decodeUnknownEffect(jsonValueSchema)));
					const completed = yield* sandbox
						.executeWorkflow({
							input,
							scriptId: state.workflowScriptId,
							pluginRevision: state.pluginRevision,
							executionId: `${scope.runId}-confirmation-${identity}-${attempt}`,
							subject: {
								type: "user",
								userId: scope.userId,
								integrationRunId: scope.runId,
								accountGeneration: scope.accountGeneration,
								integrationId: run.integrationId ?? undefined,
							},
						})
						.pipe(
							Effect.flatMap(
								Schema.decodeUnknownEffect(integrationConfirmationWorkflowResultSchema),
							),
							Effect.exit,
						);
					yield* database.transaction(
						repository.putSettlementActivity(scope, {
							...activity,
							completed: attempt + 1,
							lastAdvancedAt: (yield* DateTime.nowAsDate).toISOString(),
							state: Exit.isSuccess(completed) ? "completed" : "running",
						}),
					);
					if (Exit.isFailure(completed)) {
						return yield* new IntegrationConfirmationError({
							message: "Integration source confirmation did not complete",
						});
					}
					start = end;
				}
				return yield* Effect.void;
			});
			const settle = Effect.fn("IntegrationIngestion.settle")(function* (
				scope: IngestionScope,
				status: "completed" | "failed" | "cancelled",
				failureReason?: ImportRunFailureReason,
			) {
				const run = yield* repository.getIngestionRun(scope);
				return yield* execution
					.settle({
						scope,
						status,
						...(failureReason ? { failureReason } : {}),
						confirm: (batch) => confirm(scope, batch),
						reconcile: (batch) =>
							run?.pluginInstallationId === null
								? reconcileDataIngestionBatch(scope, batch)
								: reconcileGenericIngestionBatch(scope, batch),
					})
					.pipe(
						Effect.provideService(ImportsRepository, repository),
						Effect.provideService(IngestionCaptures, captures),
						Effect.provideService(DatabaseSession, database),
					);
			});
			const release = Effect.fn("IntegrationIngestion.release")(function* (
				scope: IngestionScope,
				integration: IntegrationRecord,
			) {
				const run = yield* repository.getIngestionRun(scope);
				if (!run || !["blocked", "pending"].includes(run.status)) {
					return false;
				}
				if (!(yield* inputReady(scope))) {
					return false;
				}
				if (run.plan && run.pins) {
					return run.status === "pending";
				}
				if (!integration.pluginInstallationId) {
					return false;
				}
				let prepared = yield* repository.getPreparedRelease(scope);
				if (!prepared) {
					const evaluated = yield* readiness.evaluateIntegration({
						userId: scope.userId,
						integrationId: integration.id,
						providerSlug: integration.provider,
						settings: integration.providerSpecifics,
						installationId: integration.pluginInstallationId,
					});
					if (!evaluated.readiness.ready || !evaluated.readiness.plan || !evaluated.script) {
						return false;
					}
					const plan = evaluated.readiness.plan;
					const integrationScriptSlug = plan.selection["integration-adapter"];
					if (
						plan.operation !== evaluated.script.slug ||
						typeof integrationScriptSlug !== "string" ||
						!integrationScriptSlug
					) {
						return yield* new ImportRunError({
							message: "Integration execution plan does not select its adapter",
						});
					}
					const script = yield* scripts.findWorkflowScriptAvailableToUser(
						scope.userId,
						evaluated.provider.pluginId,
						"integration",
						integration.pluginInstallationId,
					);
					if (!script || script.id !== evaluated.script.id) {
						return false;
					}
					const pins = {
						...evaluated.pins,
						scriptId: script.id,
						executionId: `${scope.runId}-import`,
					};
					yield* pinning.preRegister({
						scope,
						expectedPins: pins,
						scriptId: script.id,
						executionId: pins.executionId,
						executingUserId: scope.userId,
						pluginId: evaluated.provider.pluginId,
						accountGeneration: scope.accountGeneration,
						preparedRelease: {
							plan,
							requiresProKey: evaluated.provider.requiresProKey ?? false,
							state: {
								namedArtifactPaths: {},
								workflowScriptId: script.id,
								source: integration.provider,
								pluginId: evaluated.provider.pluginId,
								pluginInstallationId: integration.pluginInstallationId,
								sourcePayload: { integrationScriptSlug, integrationId: integration.id },
							},
						},
					});
					prepared = yield* repository.getPreparedRelease(scope);
				}
				const current = yield* repository.getIngestionRun(scope);
				if (!prepared || !current?.pins) {
					return false;
				}
				const pins = current.pins;
				yield* states.store({ scope, state: prepared.state });
				const released = yield* database.transaction(
					run.status === "blocked"
						? repository.releaseBlocked({
								pins,
								scope,
								plan: prepared.plan,
								now: yield* DateTime.nowAsDate,
							})
						: repository.pinIngestion({ pins, scope, plan: prepared.plan }),
				);
				if (!released) {
					yield* execution.cleanup(scope);
				}
				return released;
			});
			const admitWebhook = Effect.fn("IntegrationIngestion.admitWebhook")(function* (
				integration: IntegrationRecord,
				webhook: IntegrationWebhookDelivery,
				failureReason?: ImportRunFailureReason,
			) {
				const accountGeneration = yield* receipts.currentAccount(integration.userId);
				const acceptedAt = yield* DateTime.nowAsDate;
				const evaluated =
					integration.pluginInstallationId && !failureReason
						? yield* readiness
								.evaluateIntegration({
									userId: integration.userId,
									integrationId: integration.id,
									providerSlug: integration.provider,
									settings: integration.providerSpecifics,
									installationId: integration.pluginInstallationId,
								})
								.pipe(Effect.catchTag("IngestionReadinessError", () => Effect.succeed(null)))
						: null;
				const runId = yield* database.transaction(
					Effect.gen(function* () {
						yield* receipts.admitAccount(accountGeneration);
						const createdRunId = yield* repository.createBlockedRun({
							acceptedAt,
							accountGeneration,
							userId: integration.userId,
							source: integration.provider,
							integrationId: integration.id,
							blockReasons: evaluated?.readiness.blockReasons ?? [],
							pluginInstallationId: integration.pluginInstallationId,
							inputSummary: {
								lot: integration.lot,
								integrationId: integration.id,
								provider: integration.provider,
							},
						});
						if (failureReason) {
							yield* repository.rejectBlocked({
								failureReason,
								finishedAt: acceptedAt,
								scope: { accountGeneration, runId: createdRunId, userId: integration.userId },
							});
						}
						return createdRunId;
					}),
				);
				const scope = { runId, accountGeneration, userId: integration.userId };
				if (failureReason) {
					return scope;
				}
				yield* states.storeEnvelope(scope, webhook);
				return scope;
			});
			const expire = Effect.fn("IntegrationIngestion.expire")(function* (scope: IngestionScope) {
				const expired = yield* repository.expireBlocked({ scope, now: yield* DateTime.nowAsDate });
				if (expired) {
					yield* execution.cleanup(scope);
				}
				return expired;
			});
			const recoverInput = Effect.fn("IntegrationIngestion.recoverInput")(function* (
				scope: IngestionScope,
			) {
				if (!(yield* inputReady(scope))) {
					return yield* new ImportRunError({
						message: "Integration admitted envelope is not sealed",
					});
				}
				yield* captures.recover(scope);
				const run = yield* repository.getIngestionRun(scope);
				if (!run?.plan || !run.pins) {
					return yield* new ImportRunError({ message: "Integration execution plan is not pinned" });
				}
				const state = yield* states.materialize(scope);
				if (
					state.workflowScriptId !== run.pins.scriptId ||
					state.pluginRevision.revisionId !== run.pins.pluginRevisionId ||
					state.pluginRevision.configRevisionId !== run.pins.pluginConfigRevisionId ||
					run.pins.executionId !== `${scope.runId}-import`
				) {
					return yield* new ImportRunError({
						message: "Integration executable input does not match its retained pins",
					});
				}
				return {
					...state,
					sourcePayload: {
						...state.sourcePayload,
						integrationContext: yield* admittedContext(scope),
					},
				};
			});
			const recoverable = Effect.fn("IntegrationIngestion.recoverable")(function* (input: {
				before: string;
				after: IngestionRecoveryCursor | null;
			}) {
				const rows = yield* repository.listIntegrationRecoveryRuns({
					limit: 100,
					after: input.after,
					before: DateTime.toDateUtc(DateTime.makeUnsafe(input.before)),
				});
				const last = rows.at(-1)?.run;
				return {
					next:
						rows.length === 100 && last
							? {
									id: ImportRunId.make(last.id),
									createdAt: IsoUtcString.make(last.createdAt.toISOString()),
								}
							: null,
					runs: rows.flatMap(({ run }) =>
						run.integrationId
							? [
									{
										runId: ImportRunId.make(run.id),
										userId: UserId.make(run.userId),
										integrationId: IntegrationId.make(run.integrationId),
										accountGeneration: {
											token: run.accountGeneration,
											userId: UserId.make(run.userId),
										},
									},
								]
							: [],
					),
				};
			});
			return { settle, expire, release, inputReady, recoverable, recoverInput, admitWebhook };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
