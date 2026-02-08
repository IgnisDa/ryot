import type { AutomationSandboxHostImplementationMap } from "@ryot/sandbox-sdk/core";
import { Context } from "effect";

import type { AdditionalSandboxHostImplementationMap, SandboxRunInput } from "./shared";

export type SandboxHostImplementationMaps = {
	readonly additional: AdditionalSandboxHostImplementationMap;
	readonly automation: AutomationSandboxHostImplementationMap<SandboxRunInput>;
};

export class SandboxHostImplementations extends Context.Service<
	SandboxHostImplementations,
	SandboxHostImplementationMaps
>()("SandboxHostImplementations") {}
