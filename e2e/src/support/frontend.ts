import { inject } from "vitest";

export function getFrontendUrl() {
	return inject("frontendUrl");
}
