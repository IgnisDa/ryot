import { IngestionCapture, IngestionScope } from "@ryot-app/contract/modules/imports/ingestion";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Effect, FileSystem, Schema } from "effect";
import { Workflow } from "effect/workflow";

import { DatabaseSession } from "#lib/infrastructure/db/session";
import { implementWorkflow } from "#lib/infrastructure/workflow-scope";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow } from "#modules/mutations/workflow-dispatch";
import {
	IngestionPayloads,
	ingestionPayloadDigest,
} from "#modules/uploads/object-storage/ingestion-payloads";

import { ImportsRepository } from "./repository";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";

export const captureWriteExecutionId = (scope: IngestionScope, id: string) =>
	`${scope.runId}-capture-${ingestionPayloadDigest(stableStringify([scope, id]))}`;

const CaptureWritePayload = Schema.Struct({
	scope: IngestionScope,
	id: Schema.NonEmptyString,
	temporaryPath: Schema.NullOr(Schema.String),
	maxBytes: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});
export const ProcessIngestionCaptureWorkflow = Workflow.make("ProcessIngestionCaptureWorkflow", {
	error: ImportRunError,
	success: IngestionCapture,
	payload: CaptureWritePayload,
	idempotencyKey: ({ id, scope }) => captureWriteExecutionId(scope, id),
});

export const runIngestionCaptureWrite = Effect.fn("ProcessIngestionCaptureWorkflow")(
	function* (input: typeof CaptureWritePayload.Type, executionId: string) {
		const receipts = yield* MutationReceipts.make;
		yield* admitWorkflow(
			receipts,
			ProcessIngestionCaptureWorkflow,
			input.scope.accountGeneration,
			executionId,
		);
		const repository = yield* ImportsRepository;
		const database = yield* DatabaseSession;
		const payloads = yield* IngestionPayloads;
		const fs = yield* FileSystem.FileSystem;
		const run = yield* repository.getIngestionRun(input.scope);
		if (!run || !["pending", "blocked", "running"].includes(run.status)) {
			return yield* new ImportRunError({ message: "Ingestion capture owner is not active" });
		}
		const reservation = yield* repository.getPayloadReservation(input.scope, input.id);
		if (!reservation || reservation.released || reservation.ordinal === null) {
			return yield* new ImportRunError({ message: "Ingestion payload reservation is unavailable" });
		}
		const existing = yield* repository.getCapture(input.scope, input.id);
		if (existing?.payload) {
			yield* payloads.read(existing.payload, input.maxBytes);
			return existing;
		}
		const capture = {
			id: reservation.id,
			ordinal: reservation.ordinal,
			payload: reservation.payload,
			state: reservation.captureState,
			phase: reservation.capturePhase,
			checkpoint: reservation.checkpoint,
		};
		return yield* Effect.uninterruptible(
			Effect.gen(function* () {
				yield* database.transaction(repository.startPayloadWrite(input.scope, input.id));
				yield* payloads.read(reservation.payload, input.maxBytes).pipe(
					Effect.catchTag("IngestionPayloadError", (error) =>
						Effect.gen(function* () {
							if (error.kind !== "unavailable") {
								return yield* error;
							}
							if (reservation.recoveryBytes !== null) {
								yield* payloads.write({
									maxBytes: input.maxBytes,
									payload: reservation.payload,
									bytes: Buffer.from(reservation.recoveryBytes, "base64"),
								});
							} else if (input.temporaryPath !== null) {
								if (Number((yield* fs.stat(input.temporaryPath)).size) > input.maxBytes) {
									return yield* new ImportRunError({
										message: "Ingestion capture exceeds its byte limit",
									});
								}
								yield* payloads.write({
									maxBytes: input.maxBytes,
									payload: reservation.payload,
									bytes: yield* fs.readFile(input.temporaryPath),
								});
							} else {
								yield* payloads.read(reservation.payload, input.maxBytes);
							}
							return yield* Effect.void;
						}),
					),
				);
				yield* database.transaction(
					Effect.gen(function* () {
						yield* repository.publishCapture(input.scope, capture);
						yield* repository.clearPayloadRecovery(input.scope, capture.id);
					}),
				);
				return capture;
			}),
		);
	},
	(effect) => effect.pipe(Effect.mapError(toWorkflowError)),
);

export const IngestionCaptureWorkflowDefinitionsLive = implementWorkflow(
	ProcessIngestionCaptureWorkflow,
	runIngestionCaptureWrite,
);
