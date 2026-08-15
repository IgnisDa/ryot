import { Schema, SchemaTransformation } from "effect";

export type ServerMode = "cloud" | "self-hosted";

const ServerOriginString = Schema.Trim.pipe(
	Schema.check(
		Schema.makeFilter((value) => {
			try {
				const url = new URL(value);
				return (url.protocol === "http:" || url.protocol === "https:") &&
					url.hostname &&
					!url.username &&
					!url.password &&
					url.pathname === "/" &&
					!url.search &&
					!url.hash
					? true
					: "must be an absolute HTTP or HTTPS origin";
			} catch {
				return "must be an absolute HTTP or HTTPS origin";
			}
		}),
	),
);

export const ServerOrigin = ServerOriginString.pipe(
	Schema.decodeTo(
		Schema.String,
		SchemaTransformation.transform({
			decode: (value) => new URL(value).origin,
			encode: (value) => value,
		}),
	),
	Schema.brand("ServerOrigin"),
);

export type ServerOrigin = typeof ServerOrigin.Type;

export const decodeServerOrigin = Schema.decodeUnknownSync(ServerOrigin);
export const CLOUD_ORIGIN = decodeServerOrigin("https://app.ryot.io");

export type ServerOriginResult =
	| { readonly ok: true; readonly origin: ServerOrigin }
	| { readonly ok: false; readonly reason: "invalid-server-origin" };

export const normalizeServerOrigin = (value: string) => value.trim().replace(/\/+$/, "");

export const serverApiUrl = (origin: ServerOrigin) => `${origin}/api`;

export const resolveApiUrl = (origin: ServerOrigin, value: string) =>
	new URL(value.replace(/^\/+/, ""), `${serverApiUrl(origin)}/`).toString();

export function parseServerOrigin(value: string): ServerOriginResult {
	try {
		return { ok: true, origin: decodeServerOrigin(value) };
	} catch {
		return { ok: false, reason: "invalid-server-origin" };
	}
}

export const suggestedServerOrigin = (origin: string | undefined) => {
	if (origin === undefined) {
		return "";
	}
	const result = parseServerOrigin(origin);
	return result.ok ? result.origin : "";
};

export const resolveServerOrigin = (mode: ServerMode, value: string): ServerOriginResult =>
	parseServerOrigin(mode === "cloud" ? CLOUD_ORIGIN : value);
