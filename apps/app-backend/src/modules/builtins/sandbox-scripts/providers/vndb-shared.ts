import type { SandboxHost } from "@ryot/sandbox-sdk";
import dayjs from "@ryot/sandbox-sdk/dayjs";

export type VndbHost = SandboxHost<readonly ["httpCall"]>;

export type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
	value !== null && typeof value === "object" && !Array.isArray(value);

export const asRecord = (value: unknown): UnknownRecord | null => (isRecord(value) ? value : null);

export const stringValue = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

export const numberValue = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

const BASE_URL = "https://api.vndb.org/kana";

const parseJsonResponse = (responseBody: string) => {
	try {
		const value: unknown = JSON.parse(responseBody);
		return value;
	} catch {
		throw new Error("VNDB returned invalid JSON");
	}
};

// VNDB partial dates are "YYYY-MM-DD", "YYYY-MM", or "YYYY".
export const extractYear = (value: unknown) => {
	const released = stringValue(value);
	if (!released) {
		return null;
	}
	const parsed = dayjs(released);
	return parsed.isValid() ? parsed.year() : null;
};

export const extractDate = (value: unknown) => {
	const released = stringValue(value);
	if (!released || !/^\d{4}-\d{2}-\d{2}$/.test(released)) {
		return null;
	}
	return released;
};

export const vndbPost = (
	host: VndbHost,
	path: string,
	body: Readonly<UnknownRecord>,
	failureMessage: string,
): Promise<unknown> =>
	host
		.httpCall("POST", `${BASE_URL}/${path}`, {
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
		.then((response) => {
			if (!response.success) {
				throw new Error(response.error || failureMessage);
			}
			return parseJsonResponse(response.data.body);
		});

export const readResults = (payload: unknown) => {
	const results = asRecord(payload)?.["results"];
	return Array.isArray(results) ? results : [];
};

export const readTotalItems = (payload: unknown) => {
	const count = numberValue(asRecord(payload)?.["count"]);
	return count === null ? 0 : Math.max(0, Math.trunc(count));
};

export const readNextPage = (payload: unknown, currentPage: number) =>
	asRecord(payload)?.["more"] === true ? currentPage + 1 : null;
