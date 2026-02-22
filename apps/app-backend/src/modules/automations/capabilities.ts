export const hasForbiddenGlobalRuleCapability = (allowlist: ReadonlyArray<string>) =>
	allowlist.includes("sendNotification");

export const resolveRuleCapabilityCeiling = (input: {
	isGlobalRule: boolean;
	scriptAllowlist: ReadonlyArray<string>;
}) =>
	input.isGlobalRule
		? input.scriptAllowlist.filter((name) => name !== "sendNotification")
		: input.scriptAllowlist;
