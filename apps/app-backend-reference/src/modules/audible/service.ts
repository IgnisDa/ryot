import { DurableDeferred } from "@effect/workflow";
import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Clock, Context, Effect, Layer, Schema } from "effect";

import type { CurrentUserValue } from "../../lib/auth";
import type { DbError, SandboxRunError, UploadNotFound } from "../../lib/errors";
import { AudibleRunError, AudibleRunNotFound, ValidationError } from "../../lib/errors";
import { UploadsRepository } from "../uploads/repository";
import { AudibleRepository } from "./repository";
import type { AudibleRun, AudibleRunDetail, CreateAudibleRunPayload } from "./schemas";
import {
	AudibleImportConfirmationSignal,
	ProcessAudibleRunWorkflow,
	pollWorkflowTag,
} from "./workflows";

type NormalizedCreateInput = {
	readonly query?: string;
	readonly uploadId?: string;
};

export class AudibleService extends Context.Tag("AudibleService")<
	AudibleService,
	{
		readonly confirmImport: (
			user: CurrentUserValue,
			runId: string,
		) => Effect.Effect<
			AudibleRunDetail,
			DbError | AudibleRunError | AudibleRunNotFound | ValidationError
		>;
		readonly create: (
			user: CurrentUserValue,
			input: CreateAudibleRunPayload,
		) => Effect.Effect<
			AudibleRunDetail,
			DbError | AudibleRunError | SandboxRunError | UploadNotFound | ValidationError
		>;
		readonly get: (
			user: CurrentUserValue,
			runId: string,
		) => Effect.Effect<AudibleRunDetail, DbError | AudibleRunNotFound>;
		readonly list: (user: CurrentUserValue) => Effect.Effect<ReadonlyArray<AudibleRun>, DbError>;
	}
>() {}

const validateCreate = (
	input: CreateAudibleRunPayload,
): Effect.Effect<NormalizedCreateInput, ValidationError> =>
	Effect.gen(function* () {
		const query = input.query?.trim();
		const uploadId = input.uploadId?.trim();
		const hasQuery = Boolean(query);
		const hasUpload = Boolean(uploadId);

		if (hasQuery === hasUpload) {
			return yield* new ValidationError({
				message: "Provide exactly one of query or uploadId",
			});
		}

		return {
			query,
			uploadId,
		};
	});

const decodeConfirmationToken = (token: string) =>
	Schema.decodeUnknown(DurableDeferred.Token)(token).pipe(
		Effect.mapError(
			(error) =>
				new AudibleRunError({ message: `Invalid import confirmation token: ${error.message}` }),
		),
	);

export const AudibleServiceLive = Layer.effect(
	AudibleService,
	Effect.gen(function* () {
		const engine = yield* WorkflowEngine;
		const repository = yield* AudibleRepository;
		const uploads = yield* UploadsRepository;

		const detailWithPoll = (user: CurrentUserValue, runId: string) =>
			engine.poll(ProcessAudibleRunWorkflow, runId).pipe(
				Effect.map(pollWorkflowTag),
				Effect.flatMap((poll) => repository.getDetail(user.id, runId, poll)),
			);

		return {
			confirmImport: (user, runId) =>
				Effect.gen(function* () {
					const confirmation = yield* repository.getConfirmationToken(user.id, runId);
					if (confirmation.run.status !== "awaiting_confirmation" || !confirmation.token) {
						return yield* new ValidationError({
							message: "Audible import is not awaiting confirmation",
						});
					}

					const token = yield* decodeConfirmationToken(confirmation.token);
					const confirmedAt = new Date(yield* Clock.currentTimeMillis).toISOString();
					yield* DurableDeferred.succeed(AudibleImportConfirmationSignal, {
						token,
						value: {
							userId: user.id,
							confirmedAt,
						},
					}).pipe(Effect.provideService(WorkflowEngine, engine));

					return yield* detailWithPoll(user, runId);
				}),
			create: (user, input) =>
				Effect.gen(function* () {
					const normalized = yield* validateCreate(input);
					if (normalized.uploadId) {
						yield* uploads.getOwnedById(user.id, normalized.uploadId);
					}

					const run = yield* repository.createRun(user.id, normalized);
					yield* engine.execute(ProcessAudibleRunWorkflow, {
						discard: true,
						executionId: run.id,
						payload: {
							userId: user.id,
							runId: run.id,
							query: normalized.query,
							uploadId: normalized.uploadId,
						},
					});
					return yield* repository
						.getDetail(user.id, run.id, "started")
						.pipe(
							Effect.mapError((error) =>
								error instanceof AudibleRunNotFound
									? new AudibleRunError({ message: "Created run could not be loaded" })
									: error,
							),
						);
				}),
			get: (user, runId) => detailWithPoll(user, runId),
			list: (user) => repository.listForUser(user.id),
		};
	}),
);
