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
	serverPid?: number | undefined;
}>;

export const makeHarnessTarget = (input: HarnessTarget): HarnessTarget =>
	Object.freeze({ ...input });

export const apiProcessTarget = (env: NodeJS.ProcessEnv, serverPid?: number): HarnessTarget => {
	const { PORT, FRONTEND_URL, SERVER_ADMIN_ACCESS_TOKEN } = env;
	if (!PORT || !FRONTEND_URL || !SERVER_ADMIN_ACCESS_TOKEN) {
		throw new Error("API process target requires PORT, FRONTEND_URL and SERVER_ADMIN_ACCESS_TOKEN");
	}
	return makeHarnessTarget({
		serverPid,
		frontendUrl: FRONTEND_URL,
		serverLogFile: env.SERVER_LOG_FILE,
		apiUrl: `http://127.0.0.1:${PORT}/api`,
		adminAccessToken: SERVER_ADMIN_ACCESS_TOKEN,
	});
};

let sharedTarget: HarnessTarget | undefined;

export const getSharedHarnessTarget = () => {
	sharedTarget ??= makeHarnessTarget({
		apiUrl: requireHarnessEnv("E2E_API_URL"),
		serverLogFile: process.env.E2E_SERVER_LOG_FILE,
		frontendUrl: requireHarnessEnv("E2E_FRONTEND_URL"),
		adminAccessToken: requireHarnessEnv("E2E_ADMIN_ACCESS_TOKEN"),
		serverPid: process.env.E2E_SERVER_PID ? Number(process.env.E2E_SERVER_PID) : undefined,
	});
	return sharedTarget;
};

export const getApiUrl = () => getSharedHarnessTarget().apiUrl;
export const getFrontendUrl = () => getSharedHarnessTarget().frontendUrl;
export const getAdminAccessToken = () => getSharedHarnessTarget().adminAccessToken;
export const getServerLogFile = () => getSharedHarnessTarget().serverLogFile;
