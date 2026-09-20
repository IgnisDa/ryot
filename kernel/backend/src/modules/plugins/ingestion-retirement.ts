import type { DbError } from "@ryot-app/contract/errors";
import { ImportRunFailureReason } from "@ryot-app/contract/modules/imports/schemas";
import type { UserId } from "@ryot-app/contract/schema/brands";
import { Context, Schema, type Effect } from "effect";

export const PluginIngestionRetirementPolicy = Schema.Union([
	Schema.Struct({ kind: Schema.Literal("removal") }),
	Schema.Struct({
		kind: Schema.Literal("quarantine"),
		reason: Schema.Struct({
			...ImportRunFailureReason.members[0].fields,
			code: Schema.Literal("package-identity-conflict"),
		}),
	}),
]);
export type PluginIngestionRetirementPolicy = typeof PluginIngestionRetirementPolicy.Type;

export class PluginIngestionRetirement extends Context.Service<
	PluginIngestionRetirement,
	{
		retire: (input: {
			userId: UserId;
			pluginInstallationId: string;
			policy: PluginIngestionRetirementPolicy;
		}) => Effect.Effect<void, DbError>;
	}
>()("PluginIngestionRetirement") {}
