import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import dayjs from "@ryot/sandbox-sdk/dayjs";
import { Effect } from "@ryot/sandbox-sdk/effect";

import {
	asRecord,
	numberValue,
	parseJsonResponse,
	stringValue,
	type UnknownRecord,
} from "../script-helpers/records";

export type VndbHost = SandboxHost<readonly ["httpCall"]>;

const BASE_URL = "https://api.vndb.org/kana";

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
): Effect.Effect<unknown, unknown> =>
	host
		.httpCall("POST", `${BASE_URL}/${path}`, {
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: JSON.stringify(body),
		})
		.pipe(
			Effect.mapError((error) => new Error(error.message || failureMessage)),
			Effect.map((response) => parseJsonResponse(response.body, "VNDB")),
		);

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
