import { inject } from "vitest";

export function getApiUrl() {
	return inject("apiUrl");
}
