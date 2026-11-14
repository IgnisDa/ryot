import { Context } from "effect";

export type MutationPolicy = "read" | "write" | "demo-write";

export const MutationPolicy = Context.Reference<MutationPolicy>(
	"@ryot-app/contract/MutationPolicy",
	{ defaultValue: () => "read" },
);

export const LogRouteTemplate = Context.Reference<boolean>("@ryot-app/contract/LogRouteTemplate", {
	defaultValue: () => false,
});
