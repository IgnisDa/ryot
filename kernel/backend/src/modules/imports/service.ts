import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import { dataJsonSource } from "@ryot-app/contract/modules/imports/data-json";
import type {
	IngestionPlan,
	IngestionPins,
	IngestionScope,
} from "@ryot-app/contract/modules/imports/ingestion";
import {
	ImportConflictError,
	ImportNotFoundError,
	ImportRequestError,
	type CreateImportRunBody,
	type ImportRunStatus,
} from "@ryot-app/contract/modules/imports/schemas";
import type { ImportRunSource } from "@ryot-app/contract/modules/imports/types";
import type { IntegrationLot } from "@ryot-app/contract/modules/integrations/types";
import {
	AutomationExecutionId,
	UserId,
	ImportRunId,
	type IntegrationId,
	type SandboxScriptId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, Exit, Layer, Result } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { DownloadTickets } from "#lib/infrastructure/download-tickets";
import { AuthRepository } from "#modules/auth/repository";
import { MutationReceipts } from "#modules/mutations/receipts";
import { dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import {
	ImportSourceCatalog,
	type RegisteredImportSource,
} from "#modules/plugins/import-source-catalog";
import { IngestionReadinessService } from "#modules/plugins/ingestion-readiness-service";
import { UploadIntentsService } from "#modules/uploads/intents/service";

import { DataImportAdmission } from "./data-admission";
import { IngestionExecution } from "./execution-service";
import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { createIssuesExport } from "./issue-export";
import { ImportsRepository } from "./repository";
import { validateFileExtension } from "./runtime/import-files";
import {
	buildImportInputSummary,
	buildImportSourcePayload,
	parseRegistryImportSourceInput,
	registryImportSourceFileInputs,
	type ImportSourceFileInput,
} from "./runtime/source-metadata";
import type { ImportSourceState } from "./runtime/source-state";
import { ImportSourceStateStore } from "./runtime/source-state-store";
import { ImportWorkflowPinning } from "./workflow-pinning";

export type CreateManualImportRunInput = {
	accountGeneration: IngestionScope["accountGeneration"];
	userId: UserId;
	source: ImportRunSource;
	pluginInstallationId: string | null;
	inputSummary: Record<string, unknown>;
};

export type DeleteImportRunInput = { userId: UserId; runId: ImportRunId };

type DispatchImportRunInput = {
	plan: IngestionPlan;
	pins: Omit<IngestionPins, "executionId">;
	runId: ImportRunId;
	user: CurrentUserValue;
	source: ImportRunSource;
	workflowScriptId: SandboxScriptId;
	registered: RegisteredImportSource;
	sourcePayload: ImportSourceState["sourcePayload"];
	uploadIntentIds: ReadonlyArray<string>;
	namedArtifactPaths: ImportSourceState["namedArtifactPaths"];
};

const isTerminalStatus = (status: ImportRunStatus): boolean =>
	status === "completed" || status === "failed" || status === "cancelled" || status === "expired";

export class ImportsService extends Context.Service<ImportsService>()("ImportsService", {
	make: Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const database = yield* DatabaseSession;
		const uploads = yield* UploadIntentsService;
		const repository = yield* ImportsRepository;
		const downloadTickets = yield* DownloadTickets;
		const authRepository = yield* AuthRepository;
		const importSources = yield* ImportSourceCatalog;
		const dataAdmission = yield* DataImportAdmission;
		const sourceStates = yield* ImportSourceStateStore;
		const workflowPinning = yield* ImportWorkflowPinning;
		const receipts = yield* MutationReceipts.make;
		const readiness = yield* IngestionReadinessService;
		const execution = yield* IngestionExecution;

		const createManualRun = Effect.fn("ImportsService.createManualRun")(function* (
			input: CreateManualImportRunInput,
		) {
			return yield* database
				.transaction(
					Effect.gen(function* () {
						yield* receipts.admitAccount(input.accountGeneration);
						return yield* repository.createManualRun(input);
					}),
				)
				.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
		});

		const updateInputSummary = repository.updateInputSummary;
		const getRunControlForUser = repository.getRunControlForUser;

		const deleteRun = Effect.fn("ImportsService.delete")(function* (input: DeleteImportRunInput) {
			yield* repository.deleteRunById(input);
		});

		const cleanupUploads = (intentIds: ReadonlyArray<string>) =>
			Effect.forEach(
				new Set(intentIds),
				(intentId) => uploads.deleteTemporaryUpload(intentId).pipe(Effect.ignore),
				{ discard: true },
			);
		const dispatchImportRun = Effect.fn("ImportsService.dispatchImportRun")(function* (
			input: DispatchImportRunInput,
		) {
			const { user, runId, uploadIntentIds } = input;
			const scope = { runId, userId: user.id, accountGeneration: user.accountGeneration };
			const run = yield* repository.getIngestionRun(scope).pipe(Effect.orDie);
			if (!run) {
				return yield* new ImportRequestError({ reason: { field: null, code: "invalid-input" } });
			}
			const sandboxExecutionId = `${runId}-import`;
			const command = rootLifecycleCommand({
				source: "import",
				importRunId: runId,
				initiator: { id: user.id, kind: "user" },
				accountGeneration: user.accountGeneration,
				occurredAt: IsoUtcString.make(run.acceptedAt),
				executionId: AutomationExecutionId.make(runId),
				itemIdentity: stableStringify(["import-run", runId]),
			});
			const failDispatch = Effect.fn("ImportsService.failDispatch")(function* (
				operation: string,
				cause: unknown,
			) {
				yield* Effect.logError(`import dispatch failed at ${operation}`, cause);
				yield* execution.abortAdmission(scope).pipe(Effect.orDie);
				return yield* new ImportRequestError({
					reason: { operation: "import-run", code: "queue-unavailable" },
				});
			});

			const pin = yield* workflowPinning
				.preRegister({
					scope,
					executingUserId: user.id,
					executionId: sandboxExecutionId,
					scriptId: input.workflowScriptId,
					pluginId: input.registered.pluginId,
					accountGeneration: user.accountGeneration,
					expectedPins: { ...input.pins, executionId: sandboxExecutionId },
				})
				.pipe(Effect.result);
			if (Result.isFailure(pin)) {
				yield* cleanupUploads(uploadIntentIds);
				return yield* failDispatch("workflow-pin", pin.failure);
			}

			const stored = yield* sourceStates
				.store({
					scope,
					state: {
						source: input.source,
						sourcePayload: input.sourcePayload,
						pluginId: input.registered.pluginId,
						workflowScriptId: input.workflowScriptId,
						pluginRevision: pin.success.pluginRevision,
						namedArtifactPaths: input.namedArtifactPaths,
						pluginInstallationId: input.registered.installationId,
					},
				})
				.pipe(Effect.exit);
			if (Exit.isFailure(stored)) {
				yield* cleanupUploads(uploadIntentIds);
				return yield* failDispatch("source-state", stored.cause);
			}
			yield* repository
				.pinIngestion({
					scope,
					plan: input.plan,
					pins: { ...input.pins, executionId: sandboxExecutionId },
				})
				.pipe(Effect.catch((error) => failDispatch("plan-pin", error)));
			yield* cleanupUploads(uploadIntentIds);

			const started = yield* dispatchAdmittedWorkflow(
				receipts,
				engine,
				ProcessImportRunWorkflow,
				command.accountGeneration,
				{ discard: true, executionId: runId, payload: { runId, command, userId: user.id } },
				(admission) => admission,
				(dispatch) => dispatch,
			).pipe(Effect.result);
			if (Result.isFailure(started)) {
				yield* Effect.logError("accepted ingestion dispatch deferred", { runId });
			}

			return { id: runId };
		});

		const startFileImportRun = Effect.fn("ImportsService.startFileImportRun")(function* (
			user: CurrentUserValue,
			body: CreateImportRunBody,
			properties: Readonly<Record<string, unknown>>,
			sourceFileInputs: ReadonlyArray<ImportSourceFileInput>,
			registered: RegisteredImportSource,
			workflowScriptId: SandboxScriptId,
			plan: IngestionPlan,
			pins: Omit<IngestionPins, "executionId">,
		) {
			const fileNames: Record<string, string> = {};
			const claimedUploadIntentIds: string[] = [];
			const namedArtifactPaths: Record<string, string> = {};
			const sourcePayload = buildImportSourcePayload(properties, registered) ?? {};
			const created = yield* createManualRun({
				userId: user.id,
				source: body.source,
				accountGeneration: user.accountGeneration,
				pluginInstallationId: registered.installationId,
				inputSummary: buildImportInputSummary(body.source, {}),
			}).pipe(Effect.result);
			if (Result.isFailure(created)) {
				return yield* created.failure;
			}
			const run = created.success;

			for (const sourceFileInput of sourceFileInputs) {
				const claim = yield* uploads
					.claimTemporaryUpload(sourceFileInput.uploadToken, user.id, run.id)
					.pipe(Effect.result);
				if (Result.isFailure(claim)) {
					yield* cleanupUploads(claimedUploadIntentIds);
					yield* deleteRun({ runId: run.id, userId: user.id }).pipe(Effect.ignore);
					return yield* new ImportRequestError({
						reason: { code: "upload-unavailable", field: sourceFileInput.key },
					});
				}
				claimedUploadIntentIds.push(claim.success.intentId);
				if (claim.success.locator.type !== "local" || !claim.success.resolvedPath) {
					yield* cleanupUploads(claimedUploadIntentIds);
					yield* deleteRun({ runId: run.id, userId: user.id }).pipe(Effect.ignore);
					return yield* new ImportRequestError({
						reason: { code: "upload-unavailable", field: sourceFileInput.key },
					});
				}

				const safePath = claim.success.resolvedPath;

				yield* validateFileExtension(
					claim.success.fileName,
					sourceFileInput.allowedExtensions,
				).pipe(
					Effect.catch(() =>
						cleanupUploads(claimedUploadIntentIds).pipe(
							Effect.andThen(deleteRun({ runId: run.id, userId: user.id }).pipe(Effect.ignore)),
							Effect.flatMap(
								() =>
									new ImportRequestError({
										reason: {
											code: "unsupported-file-extension",
											allowedExtensions: sourceFileInput.allowedExtensions,
										},
									}),
							),
						),
					),
				);

				fileNames[sourceFileInput.key] = claim.success.fileName;
				namedArtifactPaths[sourceFileInput.key] = safePath;
			}

			const summarized = yield* updateInputSummary({
				runId: run.id,
				inputSummary: buildImportInputSummary(body.source, fileNames),
			}).pipe(Effect.result);
			if (Result.isFailure(summarized)) {
				yield* cleanupUploads(claimedUploadIntentIds);
				yield* deleteRun({ runId: run.id, userId: user.id }).pipe(Effect.ignore);
				return yield* summarized.failure;
			}
			return yield* dispatchImportRun({
				plan,
				pins,
				user,
				registered,
				runId: run.id,
				sourcePayload,
				workflowScriptId,
				namedArtifactPaths,
				source: body.source,
				uploadIntentIds: claimedUploadIntentIds,
			});
		});

		const startSourcePayloadImportRun = Effect.fn("ImportsService.startSourcePayloadImportRun")(
			function* (
				user: CurrentUserValue,
				body: CreateImportRunBody,
				properties: Readonly<Record<string, unknown>>,
				registered: RegisteredImportSource,
				workflowScriptId: SandboxScriptId,
				plan: IngestionPlan,
				pins: Omit<IngestionPins, "executionId">,
			) {
				const inputSummary = buildImportInputSummary(body.source, {});
				const sourcePayload = buildImportSourcePayload(properties, registered) ?? {};
				const run = yield* createManualRun({
					inputSummary,
					userId: user.id,
					source: body.source,
					accountGeneration: user.accountGeneration,
					pluginInstallationId: registered.installationId,
				});
				return yield* dispatchImportRun({
					plan,
					pins,
					user,
					registered,
					runId: run.id,
					sourcePayload,
					workflowScriptId,
					uploadIntentIds: [],
					source: body.source,
					namedArtifactPaths: {},
				});
			},
		);

		const startImportRun = Effect.fn("ImportsService.startImportRun")(function* (
			user: CurrentUserValue,
			body: CreateImportRunBody,
		) {
			if (body.source === dataJsonSource) {
				return yield* dataAdmission.startUpload(user, body);
			}
			const resolution = yield* importSources.resolveForUser(user.id, body.source);
			if (!resolution) {
				return yield* new ImportRequestError({
					reason: { source: body.source, code: "source-not-found" },
				});
			}
			const registered = resolution.source;
			const workflowScript = resolution.script;
			if (!workflowScript) {
				return yield* new ImportRequestError({
					reason: { source: body.source, code: "workflow-unavailable" },
				});
			}
			const properties = yield* parseRegistryImportSourceInput(registered, body).pipe(
				Effect.tapError((cause) => Effect.logWarning("invalid import source input", cause)),
				Effect.mapError(
					() => new ImportRequestError({ reason: { field: null, code: "invalid-input" } }),
				),
			);
			const evaluated = yield* readiness
				.evaluateImport({
					userId: user.id,
					settings: properties,
					sourceSlug: body.source,
					installationId: registered.installationId,
				})
				.pipe(
					Effect.mapError(
						() => new ImportRequestError({ reason: { field: null, code: "invalid-input" } }),
					),
				);
			const plan = evaluated.readiness.plan;
			if (!evaluated.readiness.ready || !plan) {
				return yield* new ImportRequestError({
					reason: {
						source: body.source,
						code: "source-not-ready",
						blockReasons: evaluated.readiness.blockReasons,
					},
				});
			}
			const sourceFileInputs = registryImportSourceFileInputs(evaluated.source, properties);

			return sourceFileInputs.length > 0
				? yield* startFileImportRun(
						user,
						body,
						properties,
						sourceFileInputs,
						evaluated.source,
						evaluated.pins.scriptId,
						plan,
						evaluated.pins,
					)
				: yield* startSourcePayloadImportRun(
						user,
						body,
						properties,
						evaluated.source,
						evaluated.pins.scriptId,
						plan,
						evaluated.pins,
					);
		});

		const requireImportRunByUserId = Effect.fn("ImportsService.requireImportRunByUserId")(
			function* (userId: UserId, runId: ImportRunId) {
				const run = yield* repository.getRunById({ runId, userId });
				if (!run) {
					return yield* new ImportNotFoundError({ reason: { runId, code: "run-not-found" } });
				}

				return run;
			},
		);
		const requireImportRun = (user: CurrentUserValue, runId: ImportRunId) =>
			requireImportRunByUserId(user.id, runId);

		const removeImportRun = Effect.fn("ImportsService.removeImportRun")(function* (
			user: CurrentUserValue,
			runId: ImportRunId,
		) {
			const run = yield* requireImportRun(user, runId);
			if (!isTerminalStatus(run.status)) {
				return yield* new ImportConflictError({
					reason: { runId, status: run.status, code: "run-not-terminal" },
				});
			}
			yield* execution
				.deleteReport({ runId, userId: user.id, accountGeneration: user.accountGeneration })
				.pipe(Effect.orDie);
			return { id: runId };
		});

		const downloadFailuresForUser = Effect.fn("ImportsService.downloadFailuresForUser")(function* (
			userId: UserId,
			runId: ImportRunId,
		) {
			const run = yield* requireImportRunByUserId(userId, runId);
			const user = yield* authRepository.findUserById(userId);
			if (!user) {
				return yield* new ImportNotFoundError({ reason: { runId, code: "run-not-found" } });
			}
			const scope = { runId, userId, accountGeneration: { userId, token: user.accountGeneration } };
			return createIssuesExport({
				runId,
				source: run.source,
				failureReason: run.failureReason,
				listPage: (after) =>
					repository.listIssues({ scope, limit: 100, ...(after === undefined ? {} : { after }) }),
			});
		});

		const createFailuresDownloadTicket = Effect.fn("ImportsService.createFailuresDownloadTicket")(
			function* (user: CurrentUserValue, runId: ImportRunId) {
				yield* requireImportRun(user, runId);
				return yield* downloadTickets.issue({
					resource: runId,
					subject: user.id,
					purpose: "import-run-failures",
				});
			},
		);

		const downloadFailuresWithTicket = Effect.fn("ImportsService.downloadFailuresWithTicket")(
			function* (ticket: string, runId: ImportRunId) {
				const claims = yield* downloadTickets
					.verify(ticket, { resource: runId, purpose: "import-run-failures" })
					.pipe(
						Effect.catchTag("DownloadTicketInvalid", () =>
							Effect.fail(new ImportNotFoundError({ reason: { runId, code: "run-not-found" } })),
						),
					);
				if (claims.subject === null) {
					return yield* new ImportNotFoundError({ reason: { runId, code: "run-not-found" } });
				}
				return yield* downloadFailuresForUser(UserId.make(claims.subject), runId);
			},
		);

		const createIntegrationRun = (input: {
			userId: UserId;
			source: ImportRunSource;
			integrationId: IntegrationId;
			pluginInstallationId: string | null;
			integrationLot: IntegrationLot;
			inputSummary: Record<string, unknown>;
		}) =>
			database
				.transaction(repository.createIntegrationRun(input))
				.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));

		const createIntegrationRunIfIdle = (input: {
			userId: UserId;
			source: ImportRunSource;
			integrationId: IntegrationId;
			pluginInstallationId: string;
			inputSummary: Record<string, unknown>;
		}) =>
			database
				.transaction(repository.createIntegrationRunIfIdle(input))
				.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));

		const recoverRuns = Effect.fn("ImportsService.recoverRuns")(function* () {
			for (const run of yield* repository.listRecoveryRuns(100)) {
				const runId = ImportRunId.make(run.id);
				const scope = {
					runId,
					userId: UserId.make(run.userId),
					accountGeneration: { token: run.accountGeneration, userId: UserId.make(run.userId) },
				};
				if (!run.admitted && (run.status === "pending" || run.status === "cancelling")) {
					yield* execution.abortAdmission(scope);
					continue;
				}
				if (["completed", "failed", "cancelled", "expired"].includes(run.status)) {
					yield* execution.cleanup(scope);
					continue;
				}
				const command = rootLifecycleCommand({
					source: "import",
					importRunId: runId,
					accountGeneration: scope.accountGeneration,
					initiator: { kind: "user", id: scope.userId },
					executionId: AutomationExecutionId.make(runId),
					itemIdentity: stableStringify(["import-run", runId]),
					occurredAt: IsoUtcString.make(run.acceptedAt.toISOString()),
				});
				yield* dispatchAdmittedWorkflow(
					receipts,
					engine,
					ProcessImportRunWorkflow,
					scope.accountGeneration,
					{
						discard: true,
						executionId: runId,
						payload: {
							runId,
							command,
							userId: scope.userId,
							dataJson: run.source === dataJsonSource,
						},
					},
					(admission) => admission,
					(dispatch) => dispatch,
				);
			}
		});

		return {
			recoverRuns,
			startImportRun,
			createManualRun,
			removeImportRun,
			delete: deleteRun,
			updateInputSummary,
			getRunControlForUser,
			createIntegrationRun,
			createIntegrationRunIfIdle,
			downloadFailuresWithTicket,
			createFailuresDownloadTicket,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make);
}
