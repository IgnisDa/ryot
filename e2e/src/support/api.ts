import { inject } from "vitest";

export function getApiUrl() {
	return inject("apiUrl");
}

export function getApiLogFile() {
	return inject("apiLogFile");
}
