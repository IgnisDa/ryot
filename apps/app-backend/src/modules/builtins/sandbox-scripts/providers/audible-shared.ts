import type { SandboxHost } from "@ryot/sandbox-sdk";
import { load } from "@ryot/sandbox-sdk/cheerio";
import dayjs from "@ryot/sandbox-sdk/dayjs";

export type AudibleHost = SandboxHost<readonly ["httpCall"]>;

export type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
	value !== null && typeof value === "object" && !Array.isArray(value);

export const asRecord = (value: unknown): UnknownRecord | null => (isRecord(value) ? value : null);

export const stringValue = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : null;

export const numberValue = (value: unknown) =>
	typeof value === "number" && Number.isFinite(value) ? value : null;

export const trimmedString = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const parseJsonResponse = (responseBody: string, label: string) => {
	try {
		const value: unknown = JSON.parse(responseBody);
		return value;
	} catch {
		throw new Error(`${label} returned invalid JSON`);
	}
};

export const audibleFetchJson = (
	host: AudibleHost,
	url: string,
	failureMessage: string,
	label: string,
) =>
	host.httpCall("GET", url).then((response) => {
		if (!response.success) {
			throw new Error(response.error || failureMessage);
		}
		return parseJsonResponse(response.data.body, label);
	});

export const parseReleaseYear = (releaseDate: unknown) => {
	if (typeof releaseDate !== "string" || !releaseDate.trim()) {
		return null;
	}
	const parsed = dayjs(releaseDate.trim());
	return parsed.isValid() ? parsed.year() : null;
};

export const parseReleaseDate = (releaseDate: unknown) => {
	if (typeof releaseDate !== "string" || !releaseDate.trim()) {
		return null;
	}
	const parsed = dayjs(releaseDate.trim());
	return parsed.isValid() ? (parsed.toISOString().split("T")[0] ?? null) : null;
};

export const cleanHtmlDescription = (html: unknown) => {
	if (typeof html !== "string" || !html.trim()) {
		return null;
	}
	const $ = load(html);
	$("br").replaceWith("\n");
	return $.root().text().trim();
};
