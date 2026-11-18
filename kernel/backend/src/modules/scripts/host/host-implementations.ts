import { Context } from "effect";

import type { AdditionalScriptHostImplementationMap } from "#modules/scripts/authorization/capabilities";

import type { RuntimeSandboxHostImplementationMap } from "./runtime-host-functions";

export type ScriptHostImplementationMaps = {
	readonly runtime: RuntimeSandboxHostImplementationMap;
	readonly additional: AdditionalScriptHostImplementationMap;
};

export class ScriptHostImplementations extends Context.Service<
	ScriptHostImplementations,
	ScriptHostImplementationMaps
>()(
	"@ryot-app/kernel-backend/modules/scripts/host/host-implementations/ScriptHostImplementations",
) {}
