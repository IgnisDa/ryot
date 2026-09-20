import type { CurrentUserValue } from "@ryot-app/contract/auth-middleware";
import {
	DataJsonDocument,
	DataJsonImportBody,
	dataJsonSource,
} from "@ryot-app/contract/modules/imports/data-json";
import {
	ImportConflictError,
	ImportRequestError,
	type CreateImportRunBody,
} from "@ryot-app/contract/modules/imports/schemas";
import {
	AutomationExecutionId,
	type IntegrationId,
	type ImportRunId,
	type UserId,
} from "@ryot-app/contract/schema/brands";
import { IsoUtcString } from "@ryot-app/contract/schema/utils";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, DateTime, Effect, FileSystem, Layer, Schema } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { rootLifecycleCommand } from "#lib/domain/lifecycle-command";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { UploadIntentsService } from "#modules/uploads/intents/service";

import { ProcessImportRunWorkflow } from "./import-run-workflow";
import { ImportsRepository } from "./repository";
import { validateFileExtension } from "./runtime/import-files";

const maximumDocumentBytes = 32 * 1024 * 1024;

const sha256 = (value: string) => new Bun.CryptoHasher("sha256").update(value).digest("hex");

export class DataImportAdmission extends Context.Service<DataImportAdmission>()(
	"DataImportAdmission",
	{
		make: Effect.gen(function* () {
			const repository = yield* ImportsRepository;
			const uploads = yield* UploadIntentsService;
			const fs = yield* FileSystem.FileSystem;
			const engine = yield* WorkflowEngine;
			const database = yield* DatabaseSession;
			const admit = Effect.fn("DataImportAdmission.admit")(function* (input: {
				userId: UserId;
				rawBody: string;
				submissionKey: string | null;
				integrationId: IntegrationId | null;
				uploadTokenHash?: string;
			}) {
				if (new TextEncoder().encode(input.rawBody).byteLength > maximumDocumentBytes) {
					return yield* new ImportRequestError({ reason: { field: null, code: "invalid-input" } });
				}
				const document = yield* Schema.decodeEffect(Schema.fromJsonString(DataJsonDocument))(
					input.rawBody,
				).pipe(
					Effect.mapError(
						() => new ImportRequestError({ reason: { field: null, code: "invalid-input" } }),
					),
				);
				const digest = sha256(stableStringify(document));
				const admitted = yield* database
					.transaction(
						repository.admitDataSubmission({
							digest,
							document,
							userId: input.userId,
							submissionKey: input.submissionKey,
							integrationId: input.integrationId,
							inputSummary: { source: dataJsonSource },
							uploadTokenHash: input.uploadTokenHash ?? null,
						}),
					)
					.pipe(Effect.catchTag("DatabaseSessionStateError", Effect.die));
				if (admitted.digest !== digest) {
					return yield* new ImportConflictError({
						reason: { runId: admitted.runId, code: "submission-key-conflict" },
					});
				}
				return admitted;
			});
			const dispatchUpload = Effect.fn("DataImportAdmission.dispatchUpload")(function* (
				user: CurrentUserValue,
				runId: ImportRunId,
			) {
				const control = yield* repository.getRunControlForUser({ runId, userId: user.id });
				if (control?.status === "pending") {
					const command = rootLifecycleCommand({
						source: "import",
						importRunId: runId,
						initiator: { id: user.id, kind: "user" },
						executionId: AutomationExecutionId.make(runId),
						itemIdentity: stableStringify(["import-run", runId]),
						occurredAt: IsoUtcString.make((yield* DateTime.nowAsDate).toISOString()),
					});
					yield* engine
						.execute(ProcessImportRunWorkflow, {
							discard: true,
							executionId: runId,
							payload: {
								runId,
								command,
								dataJson: true,
								userId: user.id,
								uploadIntentIds: [],
								sourceStateId: runId,
							},
						})
						.pipe(
							Effect.catch((cause) =>
								Effect.gen(function* () {
									yield* Effect.logError("data import dispatch failed", cause);
									yield* repository.finishFailed({
										runId,
										finishedAt: yield* DateTime.nowAsDate,
										failureReason: { operation: "data-import", code: "queue-unavailable" },
									});
									yield* repository.releaseDataDocument(runId);
									return yield* new ImportRequestError({
										reason: { operation: "data-import", code: "queue-unavailable" },
									});
								}),
							),
						);
				}
				return { id: runId };
			});
			const startUpload = Effect.fn("DataImportAdmission.startUpload")(function* (
				user: CurrentUserValue,
				body: CreateImportRunBody,
			) {
				const input = yield* Schema.decodeUnknownEffect(DataJsonImportBody)(body).pipe(
					Effect.mapError(
						() => new ImportRequestError({ reason: { field: null, code: "invalid-input" } }),
					),
				);
				const uploadTokenHash = sha256(input.uploadToken);
				const lookup =
					input.submissionKey === undefined
						? Effect.succeed(null)
						: repository.findDataUploadRetry({
								uploadTokenHash,
								userId: user.id,
								key: input.submissionKey,
							});
				const previous = yield* lookup;
				if (previous !== null) {
					return yield* dispatchUpload(user, previous);
				}
				const submit = Effect.gen(function* () {
					const claimId =
						input.submissionKey === undefined
							? crypto.randomUUID()
							: sha256(stableStringify([user.id, input.submissionKey, uploadTokenHash]));
					const claim = yield* uploads
						.claimTemporaryUpload(input.uploadToken, user.id, claimId)
						.pipe(
							Effect.mapError(
								() =>
									new ImportRequestError({
										reason: { field: "uploadToken", code: "upload-unavailable" },
									}),
							),
						);
					return yield* Effect.gen(function* () {
						yield* validateFileExtension(claim.fileName, ["json"]).pipe(
							Effect.mapError(
								() =>
									new ImportRequestError({
										reason: { allowedExtensions: ["json"], code: "unsupported-file-extension" },
									}),
							),
						);
						if (!claim.resolvedPath || claim.locator.type !== "local") {
							return yield* new ImportRequestError({
								reason: { field: "uploadToken", code: "upload-unavailable" },
							});
						}
						const stat = yield* fs
							.stat(claim.resolvedPath)
							.pipe(
								Effect.mapError(
									() =>
										new ImportRequestError({
											reason: { field: "uploadToken", code: "upload-unavailable" },
										}),
								),
							);
						if (Number(stat.size) > maximumDocumentBytes) {
							return yield* new ImportRequestError({
								reason: { field: "uploadToken", code: "invalid-input" },
							});
						}
						const rawBody = yield* fs
							.readFileString(claim.resolvedPath)
							.pipe(
								Effect.mapError(
									() =>
										new ImportRequestError({
											reason: { field: "uploadToken", code: "upload-unavailable" },
										}),
								),
							);
						const admitted = yield* admit({
							rawBody,
							userId: user.id,
							uploadTokenHash,
							integrationId: null,
							submissionKey: input.submissionKey ?? null,
						});
						return yield* dispatchUpload(user, admitted.runId);
					}).pipe(
						Effect.ensuring(uploads.deleteTemporaryUpload(claim.intentId).pipe(Effect.ignore)),
					);
				});
				return yield* submit.pipe(
					Effect.catchTag("ImportRequestError", (error) =>
						error.reason.code === "upload-unavailable"
							? Effect.gen(function* () {
									const prev = yield* lookup;
									return prev === null ? yield* error : yield* dispatchUpload(user, prev);
								})
							: Effect.fail(error),
					),
				);
			});
			return { admit, startUpload, release: repository.releaseDataDocument };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
