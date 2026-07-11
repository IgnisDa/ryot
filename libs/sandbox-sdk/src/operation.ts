import type { Schema } from "@ryot/sandbox-sdk/effect";

import type { OperationManifest } from "./core.js";
import { SANDBOX_SCRIPT_DEFINITION, type GenericScriptDefinition } from "./driver.js";

export const defineOperation = <
	const Manifest extends OperationManifest,
	Input extends Schema.Schema.AnyNoContext,
	Output extends Schema.Schema.AnyNoContext,
>(
	definition: Omit<GenericScriptDefinition<Manifest, Input, Output>, "definitionType">,
): GenericScriptDefinition<Manifest, Input, Output> => ({
	...definition,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
});
