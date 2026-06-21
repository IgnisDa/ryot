import { Context } from "effect";

export const LogRouteTemplate = Context.Reference<boolean>("@ryot/contract/LogRouteTemplate", {
	defaultValue: () => false,
});
