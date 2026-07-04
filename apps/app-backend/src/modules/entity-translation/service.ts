import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { notFound } from "@ryot/contract/errors";
import type { EntityId, SandboxScriptId } from "@ryot/contract/schema/brands";
import { Effect } from "effect";

import { DbRunner } from "#lib/infrastructure/db/service";

import { TranslateEntityWorkflow, translateEntityExecutionId } from "./entity-translation-workflow";
import { TranslationsRepository, type TranslationOverlayInput } from "./repository";

export type RequestFillInput = {
	language: string;
	entityId: EntityId;
	externalId: string;
	properties: unknown;
	entitySchemaSlug: string;
	scriptId: SandboxScriptId;
};

export class TranslationsService extends Effect.Service<TranslationsService>()(
	"TranslationsService",
	{
		effect: Effect.gen(function* () {
			const runWithDb = yield* DbRunner;
			const engine = yield* WorkflowEngine;
			const repository = yield* TranslationsRepository;

			// Idempotently enqueue a translation fill for one entity into a target language. The workflow
			// execution id coalesces duplicate requests, so repeated requests never re-run a fill. Callers
			// must ensure the entity is already populated (a fill on an unpopulated entity writes an
			// all-null overlay row that permanently mislabels its status as "none").
			const requestFill = (input: RequestFillInput) => {
				const executionId = translateEntityExecutionId({
					language: input.language,
					entityId: input.entityId,
				});
				return engine
					.execute(TranslateEntityWorkflow, {
						executionId,
						discard: true,
						payload: {
							executionId,
							language: input.language,
							scriptId: input.scriptId,
							entityId: input.entityId,
							externalId: input.externalId,
							properties: input.properties,
							entitySchemaSlug: input.entitySchemaSlug,
						},
					})
					.pipe(
						Effect.asVoid,
						Effect.catchAllCause((cause) =>
							Effect.logWarning("translation fill enqueue failed", cause),
						),
					);
			};

			const create = Effect.fn("TranslationsService.create")(function* (
				input: TranslationOverlayInput,
			) {
				return yield* runWithDb(repository.createOverlay(input));
			});

			const update = Effect.fn("TranslationsService.update")(function* (
				input: TranslationOverlayInput,
			) {
				const updated = yield* runWithDb(repository.updateOverlay(input));
				if (!updated) {
					return yield* notFound("Translation overlay not found");
				}
				return undefined;
			});

			const upsert = Effect.fn("TranslationsService.upsert")(function* (
				input: TranslationOverlayInput,
			) {
				const existing = yield* runWithDb(
					repository.findOverlay({ entityId: input.entityId, language: input.language }),
				);
				return yield* existing ? update(input) : create(input);
			});

			const listByEntity = Effect.fn("TranslationsService.listByEntity")(function* (
				entityId: EntityId,
			) {
				return yield* runWithDb(repository.listByEntity(entityId));
			});

			return { requestFill, create, update, upsert, listByEntity };
		}),
	},
) {}
