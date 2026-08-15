import { Context } from "effect";

export const LogRouteTemplate = Context.Reference<boolean>("@ryot-app/contract/LogRouteTemplate", {
	defaultValue: () => false,
});
