import { Context } from "effect";

export type DemoAccessPolicy = "allowed" | "protected";

export const DemoAccessPolicy = Context.Reference<DemoAccessPolicy>(
	"@ryot-app/contract/DemoAccessPolicy",
	{ defaultValue: () => "allowed" },
);

export const LogRouteTemplate = Context.Reference<boolean>("@ryot-app/contract/LogRouteTemplate", {
	defaultValue: () => false,
});
