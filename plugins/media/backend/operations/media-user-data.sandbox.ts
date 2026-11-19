import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";

import { MediaUserDataInput, MediaUserDataOutput } from "../../shared/media-user-data-operations";
import { catalogMessage } from "../../shared/messages.generated";

const HostRefusal = Schema.Struct({ code: Schema.String });

const hostRefusalReason = (error: SandboxHostError) => {
	const decoded = Schema.decodeUnknownOption(HostRefusal)(error.data);
	if (decoded._tag === "None") {
		return undefined;
	}
	switch (decoded.value.code) {
		case "state-conflict":
			return catalogMessage("rejection.user-data.state-conflict");
		case "required-field":
			return catalogMessage("rejection.user-data.required-field");
		case "owner-mismatch":
		case "entity-schema-mismatch":
			return catalogMessage("rejection.user-data.media-type-mismatch");
		case "operation-denied":
			return catalogMessage("rejection.user-data.operation-denied");
		case "entity-not-found":
			return catalogMessage("rejection.user-data.entity-not-found");
		case "same-entity-merge":
			return catalogMessage("rejection.user-data.same-entity-merge");
		case "child-mapping-conflict":
			return catalogMessage("rejection.user-data.child-mapping-conflict");
		case "relationship-merge-failed":
			return catalogMessage("rejection.user-data.relationship-merge-failed");
		case "command-identity-conflict":
			return catalogMessage("rejection.user-data.command-identity-conflict");
		case "identity-property-mismatch":
			return catalogMessage("rejection.user-data.identity-mismatch");
		default:
			return undefined;
	}
};

const catchHostRefusal = (error: SandboxHostError) => {
	const reason = hostRefusalReason(error);
	return reason === undefined
		? Effect.fail(error)
		: Effect.succeed({ reason, status: "rejected" as const });
};

export const manifest = defineManifest({
	kind: "operation",
	name: "Manage media user data",
	slug: "operation.media-user-data",
});

export default defineOperation({
	manifest,
	input: MediaUserDataInput,
	output: MediaUserDataOutput,
	run: (input, host) =>
		input.action === "remove"
			? host
					.clearUserEntityData({
						entityId: input.entityId,
						entitySchemaSlug: input.entitySchemaSlug,
					})
					.pipe(
						Effect.map(({ deletedEventsCount, deletedRelationshipsCount }) => ({
							status: "saved" as const,
							count: deletedEventsCount + deletedRelationshipsCount,
						})),
						Effect.catch(catchHostRefusal),
					)
			: host
					.mergeUserEntityData({
						mergeFrom: input.mergeFrom,
						mergeInto: input.mergeInto,
						entitySchemaSlug: input.entitySchemaSlug,
					})
					.pipe(
						Effect.map(({ movedEventsCount, movedRelationshipsCount }) => ({
							status: "saved" as const,
							count: movedEventsCount + movedRelationshipsCount,
						})),
						Effect.catch(catchHostRefusal),
					),
});
