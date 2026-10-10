import { Context } from "effect";

import type { SandboxHostImplementationMap } from "./invocation";

export type SandboxHostFunctionMap = Omit<SandboxHostImplementationMap, "log" | "span">;

export class SandboxHostFunctions extends Context.Service<
	SandboxHostFunctions,
	SandboxHostFunctionMap
>()("SandboxHostFunctions") {}
