import { Schema } from "effect";

import { strictStruct } from "../../schema/utils";
import { SANDBOX_HOST_CAPABILITIES } from "../sandbox/wire";

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
	capabilities: Schema.Array(Schema.Literals([...SANDBOX_HOST_CAPABILITIES])),
});

export type SandboxExecutionMetadata = Schema.Schema.Type<typeof SandboxExecutionMetadata>;
