import { Context } from "effect";

import type { ApiScope } from "#/api/scope";
import type { ClientRuntime } from "#/runtime";

export type KernelHostServices = { readonly scope: ApiScope; readonly runtime: ClientRuntime };

export const KernelHostServices = Context.Service<KernelHostServices>(
	"@ryot-app/kernel-client/KernelHostServices",
);
