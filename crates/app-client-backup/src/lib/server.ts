export const CLOUD_URL = "https://app.ryot.io";

export function resolveServerUrl(mode: "cloud" | "self-hosted", url: string) {
	return mode === "cloud" ? CLOUD_URL : url.trim().replace(/\/$/, "");
}
