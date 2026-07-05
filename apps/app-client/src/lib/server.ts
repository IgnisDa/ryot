export const CLOUD_URL = "http://localhost:3000";

export function resolveServerUrl(mode: "cloud" | "self-hosted", url: string) {
	return mode === "cloud" ? CLOUD_URL : url.trim().replace(/\/$/, "");
}
