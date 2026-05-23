import type { EntityId, SandboxProviderId, UserId } from "@ryot/contract/schema/brands";
import { Context, Effect, Layer } from "effect";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { TranslateEntityWorkflow, translateEntityExecutionId } from "./entity-translation-workflow";
import { TranslationsRepository, type TranslationOverlayInput } from "./repository";

export type RequestFillInput = {
	userId: UserId;
	language: string;
	entityId: EntityId;
	externalId: string;
	properties: unknown;
	entitySchemaSlug: string;
	providerId: SandboxProviderId;
};

export class TranslationsService extends Context.Service<TranslationsService>()(
	"TranslationsService",
	{
		make: Effect.gen(function* () {
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
							userId: input.userId,
							language: input.language,
							entityId: input.entityId,
							externalId: input.externalId,
							providerId: input.providerId,
							properties: input.properties,
							entitySchemaSlug: input.entitySchemaSlug,
						},
					})
					.pipe(
						Effect.asVoid,
						Effect.tapCause((cause) => Effect.logWarning("translation fill enqueue failed", cause)),
						Effect.orDie,
					);
			};

			const upsert = Effect.fn("TranslationsService.upsert")(function* (
				input: TranslationOverlayInput,
			) {
				return yield* repository.upsertOverlay(input);
			});

			const listByEntity = Effect.fn("TranslationsService.listByEntity")(function* (
				entityId: EntityId,
			) {
				return yield* repository.listByEntity(entityId);
			});

			return { upsert, requestFill, listByEntity };
		}),
	},
) {
	static readonly layer = Layer.effect(this, this.make);
}
