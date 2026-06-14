export const CLOUD_URL = "https://app.ryot.io";

export const normalizeServerOrigin = (url: string) => url.trim().replace(/\/+$/, "");

export const serverApiUrl = (serverUrl: string) => `${normalizeServerOrigin(serverUrl)}/api`;

export const resolveApiUrl = (serverUrl: string, apiRelativeUrl: string) => {
	const normalizedUrl = apiRelativeUrl.replace(/^\/+/, "");
	return new URL(normalizedUrl, `${serverApiUrl(serverUrl)}/`).toString();
};

export function resolveServerUrl(mode: "cloud" | "self-hosted", url: string) {
	return mode === "cloud" ? CLOUD_URL : normalizeServerOrigin(url);
}
