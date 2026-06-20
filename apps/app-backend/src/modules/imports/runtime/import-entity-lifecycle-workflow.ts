import type { ListedEntity } from "@ryot/contract/modules/entities/schemas";
import type { ImportRunId, UserId } from "@ryot/contract/schema/brands";
import { asRecord } from "@ryot/ts-utils/predicates";
import { DateTime, Effect } from "effect";

import { dispatchLifecycleSubscriptions } from "#modules/automations/lifecycle-dispatch";

import { toWorkflowError } from "./workflow-helpers";

/**
 * Dispatches the entity-create lifecycle occurrence for an entity written by an
 * import workflow. Call from workflow-body context only (never inside an
 * `Activity.make` execute); the entity id comes from the memoized write Activity
 * result so `entity-create-<id>` stays stable across replay.
 */
export const dispatchImportEntityCreateOccurrence = (input: {
	userId: UserId;
	entity: ListedEntity;
	importRunId: ImportRunId;
	entitySchemaSlug: string;
}) => {
	const occurrenceId = `entity-create-${input.entity.id}`;
	return dispatchLifecycleSubscriptions({
		userId: input.userId,
		correlationId: occurrenceId,
		target: { kind: "entity", schemaId: input.entity.entitySchemaId },
		automation: {
			occurrenceId,
			automationDepth: 1,
			operation: "create",
			origin: { kind: "import", importRunId: input.importRunId },
			committedAt: DateTime.unsafeMake(input.entity.createdAt),
			source: {
				kind: "entity",
				after: {
					id: input.entity.id,
					name: input.entity.name,
					entitySchemaSlug: input.entitySchemaSlug,
					entitySchemaId: input.entity.entitySchemaId,
					properties: asRecord(input.entity.properties) ?? {},
				},
			},
		},
	}).pipe(Effect.mapError(toWorkflowError));
};
