import { Schema } from "effect";

import { EntitySchemaSlug, SandboxProviderId } from "../../schema/brands";
import { ListedEntity } from "../entities/schemas";

export const ImportEntityBody = Schema.Struct({
	providerId: SandboxProviderId,
	externalId: Schema.String,
	entitySchemaSlug: EntitySchemaSlug,
});

export const ImportEntityRunResult = Schema.Union(
	Schema.Struct({ status: Schema.Literal("pending") }).pipe(
		Schema.annotations({
			title: "Pending Import Run Result",
			identifier: "PendingImportEntityRunResult",
		}),
	),
	Schema.Struct({ status: Schema.Literal("failed"), error: Schema.String }).pipe(
		Schema.annotations({
			title: "Failed Import Run Result",
			identifier: "FailedImportEntityRunResult",
		}),
	),
	Schema.Struct({ status: Schema.Literal("completed"), data: ListedEntity }).pipe(
		Schema.annotations({
			title: "Completed Import Run Result",
			identifier: "CompletedImportEntityRunResult",
		}),
	),
);
