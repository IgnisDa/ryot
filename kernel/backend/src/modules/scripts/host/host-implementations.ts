import type { AutomationSandboxHostImplementationMap } from "@ryot-app/sandbox-sdk/core";
import type {
	AdditionalSandboxHostImplementationMap,
	SandboxRunInput,
} from "@ryot-app/sandbox/host/invocation";
import { Context } from "effect";

import type { EntityLifecycleHostSteps } from "#modules/entities/script-host";
import type { EventLifecycleHostSteps } from "#modules/events/script-host";
import type { RelationshipLifecycleHostSteps } from "#modules/relationships/script-host";

import type { RuntimeSandboxHostImplementationMap } from "./runtime-host-functions";

export type ScriptLifecycleHostSteps = EventLifecycleHostSteps &
	EntityLifecycleHostSteps &
	RelationshipLifecycleHostSteps;

export type ScriptHostImplementationMaps = {
	readonly runtime: RuntimeSandboxHostImplementationMap;
	readonly additional: AdditionalSandboxHostImplementationMap;
	readonly automation: AutomationSandboxHostImplementationMap<SandboxRunInput>;
	readonly lifecycle: ScriptLifecycleHostSteps;
};

export class ScriptHostImplementations extends Context.Service<
	ScriptHostImplementations,
	ScriptHostImplementationMaps
>()("ScriptHostImplementations") {}
