import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { DateTime, Effect, Option } from "@ryot/sandbox-sdk/effect";

import { parseJsonResponse } from "../script-helpers/records";

export type AudibleHost = SandboxHost<readonly ["httpCall"]>;

export const audibleFetchJson = (
	host: AudibleHost,
	url: string,
	failureMessage: string,
	label: string,
) =>
	host.httpCall("GET", url).pipe(
		Effect.mapError((error) => new Error(error.message || failureMessage)),
		Effect.map((response) => parseJsonResponse(response.body, label)),
	);

export const parseReleaseYear = (releaseDate: unknown) => {
	if (typeof releaseDate !== "string" || !releaseDate.trim()) {
		return null;
	}
	const parsed = DateTime.make(releaseDate.trim());
	if (Option.isNone(parsed)) {
		return null;
	}
	return DateTime.toDateUtc(parsed.value).getFullYear();
};

export const parseReleaseDate = (releaseDate: unknown) => {
	if (typeof releaseDate !== "string" || !releaseDate.trim()) {
		return null;
	}
	const parsed = DateTime.make(releaseDate.trim());
	if (Option.isNone(parsed)) {
		return null;
	}
	return DateTime.formatIsoDateUtc(parsed.value);
};
