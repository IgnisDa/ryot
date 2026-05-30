import type { ServiceResult } from "./result";

type MaybeSkipped = { skipped: true; [key: string]: unknown };

export const expectDataResult = <T>(result: ServiceResult<T> | MaybeSkipped): T => {
	if ("skipped" in result) {
		throw new Error("Expected data result, got skip");
	}
	const r = result;
	if ("error" in r) {
		throw new Error(`Expected data result, got ${r.error}`);
	}
	return r.data;
};

export const expectErrorResult = <T>(result: ServiceResult<T>) => {
	if (!("error" in result)) {
		throw new Error("Expected error result, got data");
	}

	return result;
};
