import type { JsonValue } from "@ryot/contract/modules/ryotql/language";
import type { SandboxHost } from "@ryot/sandbox-sdk/core";
import { Effect } from "@ryot/sandbox-sdk/effect";

import {
	asRecord,
	parseJsonResponse,
	stringValue,
	type UnknownRecord,
} from "../script-helpers/records";

export type HardcoverHost = SandboxHost<readonly ["httpCall", "getPluginConfig"]>;

const HARDCOVER_GQL_URL = "https://api.hardcover.app/v1/graphql";

export const idValue = (value: unknown) => {
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed ? trimmed : null;
	}
	return null;
};

export const getHardcoverApiKey = (host: HardcoverHost) =>
	host.getPluginConfig(["hardcoverApiKey"]).pipe(
		Effect.map(({ hardcoverApiKey }) => hardcoverApiKey),
		Effect.mapError((error) => new Error(error.message || "Could not load Hardcover API key")),
		Effect.map((value) => {
			const apiKey = stringValue(value);
			if (!apiKey) {
				throw new Error("RYOT_PLUGIN_MEDIA_HARDCOVER_API_KEY is not configured");
			}
			return apiKey;
		}),
	);

export const hardcoverGql = (
	host: HardcoverHost,
	body: JsonValue,
	apiKey: string,
	failureMessage: string,
) =>
	host
		.httpCall("POST", HARDCOVER_GQL_URL, {
			body: JSON.stringify(body),
			headers: { Authorization: apiKey, "Content-Type": "application/json" },
		})
		.pipe(
			Effect.mapError((error) => new Error(error.message || failureMessage)),
			Effect.map((response) => parseJsonResponse(response.body, "Hardcover")),
		);

export const firstGraphqlErrorMessage = (payload: UnknownRecord | null) => {
	const errors = payload?.["errors"];
	if (!Array.isArray(errors) || errors.length === 0) {
		return null;
	}
	const firstError = asRecord(errors[0]);
	const message = firstError?.["message"];
	return typeof message === "string" ? message : "unknown GraphQL error";
};

export const escapeGraphqlString = (value: string) => value.replace(/"/g, '\\"');
