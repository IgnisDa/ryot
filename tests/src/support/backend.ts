import { inject } from "vitest";

export function getBackendUrl() {
	return inject("backendUrl");
}
