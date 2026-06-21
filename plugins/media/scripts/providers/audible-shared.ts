import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import dayjs from "@ryot/sandbox-sdk/dayjs";

import { parseJsonResponse } from "../script-helpers/records";

export type AudibleHost = SandboxHost<readonly ["httpCall"]>;

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
