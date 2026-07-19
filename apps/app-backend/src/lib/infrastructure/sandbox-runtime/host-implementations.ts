import type { AutomationSandboxHostImplementationMap } from "@ryot/sandbox-sdk/core";
import { Context } from "effect";

import type { RuntimeSandboxHostImplementationMap } from "./runtime-host-functions";
import type { AdditionalSandboxHostImplementationMap, SandboxRunInput } from "./shared";

export type SandboxHostImplementationMaps = {
	readonly runtime: RuntimeSandboxHostImplementationMap;
	readonly additional: AdditionalSandboxHostImplementationMap;
	readonly automation: AutomationSandboxHostImplementationMap<SandboxRunInput>;
};

export class SandboxHostImplementations extends Context.Service<
	SandboxHostImplementations,
	SandboxHostImplementationMaps
>()("SandboxHostImplementations") {}
