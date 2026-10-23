import type { JsonValue } from "@ryot-app/contract/schema/json";
import {
	MediaActivityLogInput,
	MediaActivityLogOutput,
} from "@ryot-app/media-plugin/shared/media-activity-operations";
import { PLUGIN_PACKAGE_ID } from "@ryot-app/media-plugin/shared/plugin-identity";
import { defineOperationRecipe } from "@ryot-app/plugin-kit/operations";
import { Effect } from "effect";

import type { Client } from "~/fixtures/kernel/auth";
import { getEntity } from "~/fixtures/kernel/entities";
import { invokeEncodedOperation, invokeOperation } from "~/fixtures/kernel/operations";
import { assertPresent } from "~/support/assertions";

const mediaActivityLogRecipe = defineOperationRecipe({
	packageId: PLUGIN_PACKAGE_ID,
	input: MediaActivityLogInput,
	output: MediaActivityLogOutput,
	operationSlug: "media-activity-log",
});

export const logMediaActivity = (client: Client, input: MediaActivityLogInput) =>
	invokeOperation(client, mediaActivityLogRecipe, input, { idempotencyKey: input.submissionId });

export const logMediaActivityUnchecked = (
	client: Client,
	submissionId: string,
	payload: JsonValue,
) =>
	invokeEncodedOperation(client, mediaActivityLogRecipe, payload, { idempotencyKey: submissionId });

export const mediaReferenceForEntity = (client: Client, entityId: string) =>
	Effect.gen(function* () {
		const entity = yield* getEntity(client, entityId);
		assertPresent(entity.entitySchemaPluginId, "Expected a plugin-owned media entity");
		return { kind: "local", pluginId: entity.entitySchemaPluginId } as const;
	});
