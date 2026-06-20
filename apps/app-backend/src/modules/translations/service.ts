import { WorkflowEngine } from "@effect/workflow/WorkflowEngine";
import { Effect } from "effect";

import type { EntityId, SandboxScriptId } from "#lib/schema/brands";

import { TranslateEntityWorkflow, translateEntityExecutionId } from "./workflows";

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
			const engine = yield* WorkflowEngine;

			// Idempotently enqueue a translation fill for one entity into a target language. The workflow
			// execution id coalesces duplicate requests, so repeated interest declarations never re-run a
			// fill. Callers must ensure the entity is already populated (a fill on an unpopulated entity
			// writes an all-null overlay row that permanently mislabels its status as "none").
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
							Effect.logWarning("Failed to enqueue translation fill", cause),
						),
					);
			};

			return { requestFill };
		}),
	},
) {}
