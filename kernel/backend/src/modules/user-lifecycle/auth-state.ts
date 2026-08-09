export const classifyAuthState = (accounts: ReadonlyArray<{ providerId: string }>) => {
	const hasCredential = accounts.some((account) => account.providerId === "credential");
	const hasOidc = accounts.some((account) => account.providerId === "oidc");
	if (hasCredential && hasOidc) {
		return "mixed" as const;
	}
	if (hasCredential) {
		return "credential" as const;
	}
	if (hasOidc) {
		return "oidc" as const;
	}
	return "none" as const;
};
