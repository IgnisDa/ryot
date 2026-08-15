export const CLOUD_ORIGIN = "https://app.ryot.io";

export type ServerOrigin = string;
export type ServerMode = "cloud" | "self-hosted";

export type ServerOriginResult =
	| { readonly ok: true; readonly origin: ServerOrigin }
	| { readonly ok: false; readonly reason: "invalid-server-origin" };

export const normalizeServerOrigin = (value: string) => value.trim().replace(/\/+$/, "");

export const serverApiUrl = (origin: ServerOrigin) => `${normalizeServerOrigin(origin)}/api`;

export function parseServerOrigin(value: string): ServerOriginResult {
	const normalized = normalizeServerOrigin(value);

	try {
		const url = new URL(normalized);
		if (
			(url.protocol !== "http:" && url.protocol !== "https:") ||
			!url.hostname ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		) {
			return { ok: false, reason: "invalid-server-origin" };
		}

		return { ok: true, origin: normalizeServerOrigin(url.toString()) };
	} catch {
		return { ok: false, reason: "invalid-server-origin" };
	}
}

export const resolveServerOrigin = (mode: ServerMode, value: string): ServerOriginResult =>
	parseServerOrigin(mode === "cloud" ? CLOUD_ORIGIN : value);
