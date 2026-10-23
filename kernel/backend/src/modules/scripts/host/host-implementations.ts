import type { AutomationSandboxHostImplementationMap } from "@ryot-app/plugin-backend-sdk/core";
import { Context } from "effect";

import type { EntityLifecycleHostSteps } from "#modules/entities/script-host";
import type { EventLifecycleHostSteps } from "#modules/events/script-host";
import type { RelationshipLifecycleHostSteps } from "#modules/relationships/script-host";
import type {
	AdditionalScriptHostImplementationMap,
	ScriptRunInput,
} from "#modules/scripts/authorization/capabilities";

import type { RuntimeSandboxHostImplementationMap } from "./runtime-host-functions";

export type ScriptLifecycleHostSteps = EventLifecycleHostSteps &
	EntityLifecycleHostSteps &
	RelationshipLifecycleHostSteps;

export type ScriptHostImplementationMaps = {
	readonly runtime: RuntimeSandboxHostImplementationMap;
	readonly additional: AdditionalScriptHostImplementationMap;
	readonly automation: AutomationSandboxHostImplementationMap<ScriptRunInput>;
	readonly lifecycle: ScriptLifecycleHostSteps;
};

export class ScriptHostImplementations extends Context.Service<
	ScriptHostImplementations,
	ScriptHostImplementationMaps
>()("ScriptHostImplementations") {}
