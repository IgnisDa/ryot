import { Context, type ManagedRuntime } from "effect";

import type { ApiScope } from "#/api/scope";
import { KernelHostServices } from "#/host-services";

// Tests provide runtimes with only the services the exercised definitions reach, not a full `ClientRuntime`.
export const testHostServices = (
	scope: ApiScope,
	runtime: ManagedRuntime.ManagedRuntime<never, unknown>,
) => Context.makeUnsafe(new Map([[KernelHostServices.key, { scope, runtime }]]));
