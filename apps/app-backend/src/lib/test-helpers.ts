import type { ServiceResult } from "./result";

export const expectDataResult = <T>(result: ServiceResult<T>) => {
	if ("error" in result) {
		throw new Error(`Expected data result, got ${result.error}`);
	}

	return result.data;
};

export const expectErrorResult = <T>(result: ServiceResult<T>) => {
	if (!("error" in result)) {
		throw new Error("Expected error result, got data");
	}

	return result;
};
