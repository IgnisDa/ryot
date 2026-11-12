import { Schema } from "effect";

import { PluginOperationHints, PluginOperationJsonSchema } from "../modules/plugins/manifest";
import { PluginPackageId } from "./brands";
import { strictStruct } from "./utils";

export const AgentToolDescriptor = strictStruct({
	description: Schema.String,
	name: Schema.NonEmptyString,
	hints: PluginOperationHints,
	input: PluginOperationJsonSchema,
	output: PluginOperationJsonSchema,
	source: Schema.Union([
		strictStruct({
			kind: Schema.Literals([
				"authoring",
				"run-script",
				"describe-data",
				"query",
				"collections",
				"collection-members",
			]),
		}),
		strictStruct({
			revisionId: Schema.String,
			contentHash: Schema.String,
			packageId: PluginPackageId,
			operationSlug: Schema.String,
			installationId: Schema.String,
			configRevisionId: Schema.String,
			kind: Schema.Literal("operation"),
		}),
		strictStruct({
			query: Schema.String,
			pluginId: Schema.String,
			revisionId: Schema.String,
			packageId: PluginPackageId,
			kind: Schema.Literal("declared-query"),
			scope: Schema.Literals(["user", "system"]),
		}),
	]),
});
export type AgentToolDescriptor = typeof AgentToolDescriptor.Type;
