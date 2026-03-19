import type { ServiceResult } from "./result";

export const expectDataResult = <T>(result: ServiceResult<T>) => {
	if ("error" in result) {
		throw new Error(`Expected data result, got ${result.error}`);
	}

	return result.data;
};
