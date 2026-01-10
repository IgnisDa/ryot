import type { OperationManifest } from "./core.js";
import { SANDBOX_SCRIPT_DEFINITION, type GenericScriptDefinition } from "./driver.js";

export const defineOperation = <
	const Manifest extends OperationManifest,
	const Drivers extends Record<string, unknown>,
>(definition: {
	readonly manifest: Manifest;
	readonly drivers: Drivers;
}): GenericScriptDefinition<Manifest, Drivers> => ({
	...definition,
	definitionType: SANDBOX_SCRIPT_DEFINITION,
});
