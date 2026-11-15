import { DemoOperationProtected } from "@ryot-app/contract/auth-middleware";
import type { PluginOperation } from "@ryot-app/contract/modules/plugins/manifest";
import type { AccessClass } from "@ryot-app/contract/oauth";
import { entitlementRequired, type Entitlements } from "@ryot-app/contract/schema/entitlement";

export const userOperationAccessFailure = (input: {
	readonly accessClass: AccessClass;
	readonly entitlements: Entitlements;
	readonly pluginScope: "user" | "system";
	readonly operation: Pick<
		Extract<PluginOperation, { readonly auth: "user" }>,
		"demoAccess" | "entitlement"
	>;
}) => {
	if (
		input.accessClass === "demo" &&
		(input.pluginScope !== "system" || input.operation.demoAccess === "protected")
	) {
		return new DemoOperationProtected({ reason: { code: "demo-operation-protected" } });
	}
	const required = input.operation.entitlement;
	return required !== undefined && !input.entitlements.includes(required)
		? entitlementRequired(required)
		: undefined;
};
