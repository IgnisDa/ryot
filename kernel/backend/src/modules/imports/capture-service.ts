import type { IngestionScope } from "@ryot-app/contract/modules/imports/ingestion";
import type { JsonValue } from "@ryot-app/contract/modules/ryotql/language";
import { ImportRunId } from "@ryot-app/contract/schema/brands";
import { stableStringify } from "@ryot-app/ts-utils/json";
import { Context, Effect, FileSystem, Layer, Option } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { AppConfig } from "#lib/infrastructure/config/service";
import { DatabaseSession } from "#lib/infrastructure/db/session";
import { ActivityBody } from "#lib/infrastructure/workflow-scope";
import { MutationReceipts } from "#modules/mutations/receipts";
import { admitWorkflow, dispatchAdmittedWorkflow } from "#modules/mutations/workflow-dispatch";
import {
	IngestionPayloads,
	ingestionPayloadDigest,
} from "#modules/uploads/object-storage/ingestion-payloads";

import { ProcessIngestionCaptureWorkflow, captureWriteExecutionId } from "./capture-write-workflow";
import { ImportsRepository } from "./repository";
import { ImportRunError, toWorkflowError } from "./runtime/workflow-errors";

export class IngestionCaptures extends Context.Service<IngestionCaptures>()("IngestionCaptures", {
	make: Effect.gen(function* () {
		const config = yield* AppConfig;
		const engine = yield* WorkflowEngine;
		const fs = yield* FileSystem.FileSystem;
		const database = yield* DatabaseSession;
		const payloads = yield* IngestionPayloads;
		const repository = yield* ImportsRepository;
		const receipts = yield* MutationReceipts.make;
		const execute = (
			scope: IngestionScope,
			id: string,
			maxBytes: number,
			temporaryPath: string | null,
		) =>
			dispatchAdmittedWorkflow(
				receipts,
				engine,
				ProcessIngestionCaptureWorkflow,
				scope.accountGeneration,
				{
					executionId: captureWriteExecutionId(scope, id),
					payload: { id, scope, maxBytes, temporaryPath },
				},
				(admission) => admission,
				(dispatch) => dispatch,
			);
		const publish = Effect.fn("IngestionCaptures.publish")(function* (input: {
			scope: IngestionScope;
			id: string;
			ordinal: number;
			checkpoint: JsonValue;
			bytes: Uint8Array;
			maxBytes: number;
			state: "captured" | "sealed";
			phase: "collection" | "application";
			inputFingerprint?: string;
		}) {
			if (yield* ActivityBody) {
				return yield* new ImportRunError({
					message: "Ingestion publication must be dispatched by its workflow body",
				});
			}
			const run = yield* repository.getIngestionRun(input.scope);
			if (!run || !["pending", "blocked", "running"].includes(run.status)) {
				return yield* new ImportRunError({ message: "Ingestion capture owner is not active" });
			}
			if (input.bytes.byteLength > input.maxBytes) {
				return yield* new ImportRunError({ message: "Ingestion capture exceeds its byte limit" });
			}
			const proposed = yield* payloads.describe(input);
			const reserved = yield* database.transaction(
				Effect.gen(function* () {
					const reservation = yield* repository.reservePayload(input.scope, {
						id: input.id,
						payload: proposed,
						ordinal: input.ordinal,
						captureState: input.state,
						capturePhase: input.phase,
						checkpoint: input.checkpoint,
						inputFingerprint: input.inputFingerprint ?? ingestionPayloadDigest(input.bytes),
						recoveryBytes:
							input.bytes.byteLength <= 4 * 1024 * 1024
								? Buffer.from(input.bytes).toString("base64")
								: null,
					});
					yield* admitWorkflow(
						receipts,
						ProcessIngestionCaptureWorkflow,
						input.scope.accountGeneration,
						captureWriteExecutionId(input.scope, input.id),
					);
					return reservation;
				}),
			);
			return yield* Effect.scoped(
				Effect.gen(function* () {
					let temporaryPath: string | null = null;
					if (
						reserved.recoveryBytes === null &&
						!(yield* repository.getCapture(input.scope, input.id))
					) {
						temporaryPath = yield* fs.makeTempFileScoped({
							directory: yield* fs.realPath(config.fileStorage.localTempDir),
						});
						yield* fs.writeFile(temporaryPath, input.bytes);
					}
					return yield* execute(input.scope, input.id, input.maxBytes, temporaryPath);
				}),
			).pipe(Effect.mapError(toWorkflowError));
		});
		const read = Effect.fn("IngestionCaptures.read")(function* (
			scope: IngestionScope,
			id: string,
			maxBytes: number,
		) {
			const capture = yield* repository.getCapture(scope, id);
			if (!capture?.payload) {
				return yield* new ImportRunError({
					message: "Ingestion capture is unavailable",
					reason: { code: "captured-input-unavailable" },
				});
			}
			return yield* payloads.read(capture.payload, maxBytes);
		});
		const resume = Effect.fn("IngestionCaptures.resume")(function* (
			input: Omit<Parameters<typeof publish>[0], "bytes" | "inputFingerprint">,
		) {
			if (yield* ActivityBody) {
				return yield* new ImportRunError({
					message: "Ingestion publication must be dispatched by its workflow body",
				});
			}
			const run = yield* repository.getIngestionRun(input.scope);
			if (!run || !["pending", "blocked", "running"].includes(run.status)) {
				return yield* new ImportRunError({ message: "Ingestion capture owner is not active" });
			}
			const reservation = yield* repository.getPayloadReservation(input.scope, input.id);
			if (!reservation) {
				return null;
			}
			if (
				reservation.released ||
				reservation.retiring ||
				reservation.ordinal !== input.ordinal ||
				reservation.captureState !== input.state ||
				reservation.capturePhase !== input.phase ||
				stableStringify(reservation.checkpoint) !== stableStringify(input.checkpoint)
			) {
				return yield* new ImportRunError({
					message: "Ingestion payload reservation identity changed",
				});
			}
			return yield* execute(input.scope, input.id, input.maxBytes, null).pipe(
				Effect.tap(
					Effect.fnUntraced(function* (capture) {
						if (!capture.payload) {
							return yield* new ImportRunError({ message: "Ingestion capture is unavailable" });
						}
						return yield* payloads.read(capture.payload, input.maxBytes);
					}),
				),
				Effect.mapError(toWorkflowError),
			);
		});
		const stage = Effect.fn("IngestionCaptures.stage")(function* (input: {
			scope: IngestionScope;
			ownerExecutionId: string;
			workflowExecutionId: string;
			activityExecutionId: string;
			outputIndex: number;
			bytes: Uint8Array;
		}) {
			if (input.bytes.byteLength > 4 * 1024 * 1024) {
				return yield* new ImportRunError({ message: "Staged artifact exceeds its byte limit" });
			}
			const id = `staged-${ingestionPayloadDigest(
				stableStringify([
					input.scope,
					input.ownerExecutionId,
					input.workflowExecutionId,
					input.activityExecutionId,
					input.outputIndex,
				]),
			)}`;
			const proposed = yield* payloads.describe({ ...input, id });
			const reservation = yield* database.transaction(
				repository.reservePayload(input.scope, {
					id,
					ordinal: null,
					payload: proposed,
					captureState: "sealed",
					capturePhase: "collection",
					inputFingerprint: proposed.checksum,
					stagingExecutionId: input.workflowExecutionId,
					checkpoint: { ownerExecutionId: input.ownerExecutionId },
					recoveryBytes: Buffer.from(input.bytes).toString("base64"),
				}),
			);
			if (reservation.recoveryBytes === null) {
				return yield* new ImportRunError({ message: "Staged ingestion bytes are unavailable" });
			}
			return id;
		});
		const readStaged = Effect.fn("IngestionCaptures.readStaged")(function* (
			scope: IngestionScope,
			ownerExecutionId: string,
			handle: string,
		) {
			const reservation = yield* repository.getPayloadReservation(scope, handle);
			if (
				reservation?.ordinal !== null ||
				reservation.released ||
				reservation.retiring ||
				stableStringify(reservation.checkpoint) !== stableStringify({ ownerExecutionId })
			) {
				return yield* new ImportRunError({ message: "Staged ingestion artifact is unavailable" });
			}
			if (reservation.recoveryBytes === null) {
				return yield* new ImportRunError({ message: "Staged ingestion bytes are unavailable" });
			}
			const bytes = Buffer.from(reservation.recoveryBytes, "base64");
			if (
				bytes.byteLength > 4 * 1024 * 1024 ||
				bytes.byteLength !== reservation.payload.byteSize ||
				ingestionPayloadDigest(bytes) !== reservation.payload.checksum
			) {
				return yield* new ImportRunError({ message: "Staged ingestion checksum changed" });
			}
			return bytes;
		});
		const resolveStaged = Effect.fn("IngestionCaptures.resolveStaged")(function* (
			scope: IngestionScope,
			ownerExecutionId: string,
			handle: string,
		) {
			const bytes = yield* readStaged(scope, ownerExecutionId, handle);
			const path = yield* fs.makeTempFileScoped({
				directory: yield* fs.realPath(config.fileStorage.localTempDir),
			});
			yield* fs.writeFile(path, bytes);
			return path;
		});
		const stopWrites = Effect.fn("IngestionCaptures.stopWrites")(function* (input: {
			userId: IngestionScope["userId"];
			runId?: IngestionScope["runId"];
		}) {
			for (const { runId, reservation, accountGeneration } of yield* database.transaction(
				repository.stopPayloadWrites(input),
			)) {
				const scope = {
					userId: input.userId,
					runId: ImportRunId.make(runId),
					accountGeneration: { userId: input.userId, token: accountGeneration },
				};
				if (!reservation.writeStarted) {
					continue;
				}
				const executionId = captureWriteExecutionId(scope, reservation.id);
				yield* engine.interrupt(ProcessIngestionCaptureWorkflow, executionId);
				for (;;) {
					const result = yield* engine.poll(ProcessIngestionCaptureWorkflow, executionId);
					if (Option.isSome(result) && result.value._tag === "Complete") {
						break;
					}
					yield* Effect.sleep("100 millis");
				}
			}
		});
		const cleanup = Effect.fn("IngestionCaptures.cleanup")(function* (scope: IngestionScope) {
			const run = yield* repository.getIngestionRun(scope);
			if (!run || !["completed", "failed", "cancelled", "expired"].includes(run.status)) {
				return;
			}
			yield* stopWrites(scope);
			for (const { reservation } of yield* repository.listPayloadReservations(scope)) {
				if (!reservation.released) {
					yield* payloads.remove(reservation.payload);
				}
				yield* repository.releasePayloadReservation(scope, reservation.id);
				yield* repository.releaseCapture(scope, reservation.id);
			}
		});
		const materialize = Effect.fn("IngestionCaptures.materialize")(function* (
			scope: IngestionScope,
			id: string,
			maxBytes: number,
		) {
			const capture = yield* repository.getCapture(scope, id);
			if (!capture?.payload) {
				return yield* new ImportRunError({
					message: "Ingestion capture is unavailable",
					reason: { code: "captured-input-unavailable" },
				});
			}
			return yield* payloads.materialize(capture.payload, maxBytes);
		});
		const retire = Effect.fn("IngestionCaptures.retire")(function* (input: {
			userId: IngestionScope["userId"];
			runId?: IngestionScope["runId"];
		}) {
			yield* stopWrites(input);
			for (const {
				runId,
				reservation,
				accountGeneration,
			} of yield* repository.listPayloadReservations(input)) {
				if (!reservation.released) {
					yield* payloads.remove(reservation.payload);
				}
				yield* repository.releasePayloadReservation(
					{
						userId: input.userId,
						runId: ImportRunId.make(runId),
						accountGeneration: { userId: input.userId, token: accountGeneration },
					},
					reservation.id,
				);
			}
		});
		const recover = Effect.fn("IngestionCaptures.recover")(function* (scope: IngestionScope) {
			if (yield* ActivityBody) {
				return yield* new ImportRunError({
					message: "Ingestion recovery must be dispatched by its workflow body",
				});
			}
			for (const { reservation } of yield* repository.listPayloadReservations(scope)) {
				if (
					!reservation.released &&
					reservation.ordinal !== null &&
					reservation.recoveryBytes !== null
				) {
					yield* execute(scope, reservation.id, 4 * 1024 * 1024, null);
				}
			}
			return yield* Effect.void;
		});
		return {
			read,
			stage,
			retire,
			resume,
			publish,
			cleanup,
			recover,
			stopWrites,
			readStaged,
			materialize,
			resolveStaged,
		};
	}),
}) {
	static readonly layer = Layer.effect(this, this.make).pipe(
		Layer.provide(Layer.mergeAll(ImportsRepository.layer, IngestionPayloads.layer)),
	);
}
