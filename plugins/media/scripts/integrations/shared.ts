import type { CoreSandboxHostMethodMap } from "@ryot/sandbox-sdk/core";
import { Effect, Schema } from "@ryot/sandbox-sdk/effect";

import type {
	ImportEntityRef,
	MediaIntegrationAdapterResult,
	UnresolvedEpisodeRef,
} from "../../imports/schemas";

export const SinkInput = Schema.Struct({ rawBody: Schema.String, contentType: Schema.String });

export const emptyResult = (): MediaIntegrationAdapterResult => ({
	failures: [],
	entityGroups: [],
});
export const failureResult = (
	message: string,
	stage: MediaIntegrationAdapterResult["failures"][number]["stage"] = "input_transformation",
): MediaIntegrationAdapterResult => ({
	entityGroups: [],
	failures: [{ message, stage, itemIndex: 0 }],
});
export const progressResult = (input: {
	consumedOn: string;
	occurredAt?: string;
	progressPercent: number;
	entityRef: ImportEntityRef;
	unresolvedEpisode?: UnresolvedEpisodeRef;
}): MediaIntegrationAdapterResult => ({
	failures: [],
	entityGroups: [
		{
			itemIndex: 0,
			entityRef: input.entityRef,
			collectionMemberships: [],
			events: [
				{
					eventSchemaSlug: "progress",
					occurredAt: input.occurredAt ?? new Date().toISOString(),
					properties: { consumedOn: input.consumedOn, progressPercent: input.progressPercent },
					...(input.unresolvedEpisode ? { unresolvedEpisode: input.unresolvedEpisode } : {}),
				},
			],
		},
	],
});
export const showEpisodeRef = (season?: number, episode?: number) => {
	if (season === undefined || episode === undefined) {
		return undefined;
	}
	return Number.isInteger(season) && Number.isInteger(episode) && season >= 0 && episode >= 0
		? ({ type: "show", seasonNumber: season, episodeNumber: episode } as const)
		: undefined;
};
export const progressPercent = (position?: number, duration?: number) => {
	if (
		position === undefined ||
		duration === undefined ||
		!Number.isFinite(position) ||
		duration <= 0
	) {
		return undefined;
	}
	return Math.max(0, Math.min(100, Math.round((position / duration) * 10_000) / 100));
};
export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);
export const jsonRecord = (value: string) => {
	const parsed: unknown = JSON.parse(value);
	if (!isRecord(parsed)) {
		throw new Error("Expected a JSON object");
	}
	return parsed;
};
const nested = (input: unknown, keys: string[]) => {
	const pending = [input];
	while (pending.length) {
		const current = pending.shift();
		if (!current || typeof current !== "object") {
			continue;
		}
		if (isRecord(current)) {
			for (const key of keys) {
				const value = current[key];
				if (value != null) {
					return value;
				}
			}
		}
		pending.push(...Object.values(current));
	}
	return undefined;
};
export const nestedString = (input: unknown, keys: string[]) => {
	const value = nested(input, keys);
	if (typeof value === "string") {
		return value.trim() || undefined;
	}
	if (typeof value === "number") {
		return String(value);
	}
	return undefined;
};
export const nestedNumber = (input: unknown, keys: string[]) => {
	const value = nested(input, keys);
	let number = Number.NaN;
	if (typeof value === "number") {
		number = value;
	}
	if (typeof value === "string") {
		number = Number.parseFloat(value);
	}
	return Number.isFinite(number) ? number : undefined;
};
export const specifics = (value: unknown) => (isRecord(value) ? value : null);
export const requestJson = (
	host: { readonly httpCall: CoreSandboxHostMethodMap["httpCall"] },
	method: string,
	url: string,
	options?: { body?: string; headers?: Record<string, string> },
) =>
	host.httpCall(method, url, options).pipe(
		Effect.flatMap((response) =>
			Effect.try(() => {
				const parsed: unknown = JSON.parse(response.body);
				return parsed;
			}),
		),
	);
export const baseUrl = (value: unknown) =>
	typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
