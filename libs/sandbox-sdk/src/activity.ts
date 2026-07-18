import type { Schema } from "@ryot/sandbox-sdk/effect";

import type { ActivityManifest } from "./core";
import { SANDBOX_SCRIPT_DEFINITION, type GenericScriptDefinition } from "./driver";

export const defineActivity = <
	const Manifest extends ActivityManifest,
	Input extends Schema.Codec<unknown, unknown>,
	Output extends Schema.Codec<unknown, unknown>,
>(
	definition: Omit<GenericScriptDefinition<Manifest, Input, Output>, "definitionType">,
): GenericScriptDefinition<Manifest, Input, Output> => ({
	...definition,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
});
