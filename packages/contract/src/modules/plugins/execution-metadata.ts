import { Schema } from "effect";

import { strictStruct } from "../../schema/utils";

const name = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

export const ExecutableDependency = strictStruct({
	slug: name,
	kind: Schema.Literals(["script", "workflow"]),
	selection: Schema.optional(
		strictStruct({ id: name, key: name, stage: Schema.Literals(["settings", "record"]) }),
	),
});

export const SandboxExecutionMetadata = strictStruct({
	oauthConnectionFields: Schema.Array(name),
	requiredPluginConfigKeys: Schema.Array(name),
	optionalPluginConfigKeys: Schema.Array(name),
	executableDependencies: Schema.Array(ExecutableDependency),
});

export type SandboxExecutionMetadata = Schema.Schema.Type<typeof SandboxExecutionMetadata>;
