import { defineManifest } from "@ryot-app/plugin-backend-sdk/driver";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { defineOperation } from "@ryot-app/plugin-backend-sdk/operation";
import type { SandboxHostError } from "@ryot-app/plugin-backend-sdk/wire";

import { MediaUserDataInput, MediaUserDataOutput } from "../../shared/media-user-data-operations";
import { LIBRARY_RELATIONSHIP_SCHEMA_SLUG } from "../lib/library-summary-requests";

const HostRefusal = Schema.Struct({ code: Schema.String, message: Schema.optional(Schema.String) });

const hostRefusalMessage = (error: SandboxHostError): string | undefined => {
	const decoded = Schema.decodeUnknownOption(HostRefusal)(error.data);
	if (decoded._tag === "None") {
		return undefined;
	}
	const { code, message } = decoded.value;
	switch (code) {
		case "state-conflict":
			return message ?? "Your data changed. Refresh this page and try again.";
		case "required-field":
			return "Required media item details are missing. Refresh and try again.";
		case "owner-mismatch":
			return "Choose two items with the same media type.";
		case "operation-denied":
			return "Your data cannot be changed for this media item.";
		case "entity-not-found":
			return "One of these media items no longer exists. Refresh and try again.";
		case "same-entity-merge":
			return "Choose a different item as the merge destination.";
		case "entity-schema-mismatch":
			return "Choose two items with the same media type.";
		case "child-mapping-conflict":
			return (
				message ?? "Some child data has no unique match. Refresh the media items and try again."
			);
		case "relationship-merge-failed":
			return "Some related data could not be changed. Refresh and try again.";
		case "command-identity-conflict":
			return "This request was already used for different data. Start a new request.";
		case "identity-property-mismatch":
			return "These items do not match. Choose a destination with the same identity.";
		default:
			return undefined;
	}
};

const catchHostRefusal = (error: SandboxHostError) => {
	const message = hostRefusalMessage(error);
	return message === undefined
		? Effect.fail(error)
		: Effect.succeed({ message, status: "rejected" as const });
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
	run: (input, host) => {
		const options = { submittedAt: input.submittedAt, idempotencyKey: input.submissionId };
		return input.action === "remove"
			? host
					.clearUserEntityData(
						{ entityId: input.entityId, entitySchemaSlug: input.entitySchemaSlug },
						options,
					)
					.pipe(
						Effect.map(({ deletedEventsCount, deletedRelationshipsCount }) => ({
							status: "saved" as const,
							count: deletedEventsCount + deletedRelationshipsCount,
						})),
						Effect.catch(catchHostRefusal),
					)
			: host
					.mergeUserEntityData(
						{
							mergeFrom: input.mergeFrom,
							mergeInto: input.mergeInto,
							entitySchemaSlug: input.entitySchemaSlug,
						},
						options,
					)
					.pipe(
						Effect.tap(() =>
							host.requestRelationshipProjections({
								sourceEntityIds: [input.mergeInto],
								relationshipSchemaSlug: LIBRARY_RELATIONSHIP_SCHEMA_SLUG,
							}),
						),
						Effect.map(({ movedEventsCount, movedRelationshipsCount }) => ({
							status: "saved" as const,
							count: movedEventsCount + movedRelationshipsCount,
						})),
						Effect.catch(catchHostRefusal),
					);
	},
});
