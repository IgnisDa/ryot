import { apiSuccess, type HostFunction } from "~/lib/sandbox/types";
import { getMaskedSystemConfig } from "~/modules/system";

export const createGetSystemConfigHostFunction = (
	getConfig: typeof getMaskedSystemConfig = getMaskedSystemConfig,
): HostFunction<Record<string, never>> => {
	return () => Promise.resolve(apiSuccess(getConfig()));
};

export const getSystemConfig = createGetSystemConfigHostFunction();
