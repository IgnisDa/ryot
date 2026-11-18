import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import { EntityId } from "@ryot-app/plugin-kit/schema";

import { MediaUserDataInput, MediaUserDataOutput } from "../../shared/media-user-data-operations";

export const manifest = defineManifest({
	kind: "operation",
	name: "Manage media user data",
	slug: "operation.media-user-data",
});

export default defineOperation({
	manifest,
	input: MediaUserDataInput,
	output: MediaUserDataOutput,
	run: (input) =>
		Effect.succeed({
			output: {},
			changes: {
				entities:
					input.action === "remove"
						? {
								clears: [
									{
										entityId: EntityId.make(input.entityId),
										entitySchemaSlug: input.entitySchemaSlug,
									},
								],
							}
						: {
								merges: [
									{
										entitySchemaSlug: input.entitySchemaSlug,
										mergeFrom: EntityId.make(input.mergeFrom),
										mergeInto: EntityId.make(input.mergeInto),
									},
								],
							},
			},
		}),
});
