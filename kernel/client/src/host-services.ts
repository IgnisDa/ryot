import type { ApiScope } from "#/api/scope";
import type { ClientRuntime } from "#/runtime";

export type KernelHostServices = { readonly scope: ApiScope; readonly runtime: ClientRuntime };
