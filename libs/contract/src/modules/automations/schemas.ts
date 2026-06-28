import { Schema } from "effect";

import { ImportRunId, IntegrationId, RelationshipSchemaId } from "../../schema/brands";
import { strictStruct } from "../../schema/utils";

export const SignalCatalogState = Schema.Literal("active", "hidden");

export type SignalCatalogState = typeof SignalCatalogState.Type;

export const SignalAudiencePolicy = Schema.Union(
	strictStruct({ kind: Schema.Literal("actor") }),
	strictStruct({
		kind: Schema.Literal("related_users"),
		relationshipSchemaId: RelationshipSchemaId,
		subjectSide: Schema.Literal("source", "target"),
	}),
);

export type SignalAudiencePolicy = typeof SignalAudiencePolicy.Type;

export const AutomationOrigin = Schema.Union(
	strictStruct({ kind: Schema.Literal("api") }),
	strictStruct({ kind: Schema.Literal("bootstrap") }),
	strictStruct({ kind: Schema.Literal("provider_refresh") }),
	strictStruct({
		kind: Schema.Literal("import"),
		importRunId: Schema.optional(ImportRunId),
	}),
	strictStruct({
		integrationId: IntegrationId,
		kind: Schema.Literal("integration"),
		importRunId: Schema.optional(ImportRunId),
	}),
	strictStruct({
		executionId: Schema.String,
		kind: Schema.Literal("automation"),
	}),
);

export type AutomationOrigin = typeof AutomationOrigin.Type;
