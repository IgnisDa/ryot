const requireHarnessEnv = (name: string) => {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`${name} is unset. Vitest runs receive it from global-setup.ts; scripts must set it before calling any fixture.`,
		);
	}
	return value;
};

export const getApiUrl = () => requireHarnessEnv("E2E_API_URL");

export const getFrontendUrl = () => requireHarnessEnv("E2E_FRONTEND_URL");

export const getAdminAccessToken = () => requireHarnessEnv("E2E_ADMIN_ACCESS_TOKEN");
