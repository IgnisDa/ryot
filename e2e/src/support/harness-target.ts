const requireHarnessEnv = (name: string) => {
	const value = process.env[name];
	if (!value) {
		throw new Error(
			`${name} is unset. Vitest runs receive it from global-setup.ts; scripts must set it before calling any fixture.`,
		);
	}
	return value;
};

export type HarnessTarget = Readonly<{
	apiUrl: string;
	frontendUrl: string;
	adminAccessToken: string;
	serverLogFile?: string | undefined;
}>;

export const apiProcessTarget = (env: NodeJS.ProcessEnv): HarnessTarget => {
	const { PORT, FRONTEND_URL, SERVER_ADMIN_ACCESS_TOKEN } = env;
	if (!PORT || !FRONTEND_URL || !SERVER_ADMIN_ACCESS_TOKEN) {
		throw new Error("API process target requires PORT, FRONTEND_URL and SERVER_ADMIN_ACCESS_TOKEN");
	}
	return {
		frontendUrl: FRONTEND_URL,
		serverLogFile: env.SERVER_LOG_FILE,
		apiUrl: `http://127.0.0.1:${PORT}/api`,
		adminAccessToken: SERVER_ADMIN_ACCESS_TOKEN,
	};
};

let sharedTarget: HarnessTarget | undefined;

export const getSharedHarnessTarget = () => {
	sharedTarget ??= {
		apiUrl: requireHarnessEnv("E2E_API_URL"),
		serverLogFile: process.env.E2E_SERVER_LOG_FILE,
		frontendUrl: requireHarnessEnv("E2E_FRONTEND_URL"),
		adminAccessToken: requireHarnessEnv("E2E_ADMIN_ACCESS_TOKEN"),
	};
	return sharedTarget;
};

export const getApiUrl = () => getSharedHarnessTarget().apiUrl;
export const getFrontendUrl = () => getSharedHarnessTarget().frontendUrl;
export const getAdminAccessToken = () => getSharedHarnessTarget().adminAccessToken;
