import type { ExecutionMetadata, ScriptHost } from "@ryot-app/plugin-backend-sdk/core";
import { Effect, Schema } from "@ryot-app/plugin-backend-sdk/effect";
import { asRecord } from "@ryot-app/plugin-backend-sdk/wire";

import type {
	ImportEntityRef,
	MediaIntegrationAdapterResult,
	UnresolvedEpisodeRef,
} from "../imports/schemas";
import { IntegrationConfirmationInput } from "./schemas";

export const SinkInput = Schema.Union([
	IntegrationConfirmationInput,
	Schema.Struct({ rawBody: Schema.String, contentType: Schema.String }),
]);

export const executionStartedAt = (execution: ExecutionMetadata) =>
	execution.startedAt
		? Effect.succeed(execution.startedAt)
		: Effect.fail({ message: "Sandbox execution startedAt metadata is required" });

export const emptyResult = (): MediaIntegrationAdapterResult => ({
	failures: [],
	entityGroups: [],
});

export const failureResult = (
	message: string,
	stage: MediaIntegrationAdapterResult["failures"][number]["stage"] = "input_transformation",
): MediaIntegrationAdapterResult => ({
	entityGroups: [],
	failures: [{ stage, message, itemIndex: 0 }],
	sourceFailure: stage === "source_fetch" ? "source-fetch-failed" : "input-transformation-failed",
});

export const progressResult = (input: {
	consumedOn: string;
	occurredAt: string;
	progressPercent: number;
	entityRef: ImportEntityRef;
	unresolvedEpisode?: UnresolvedEpisodeRef;
}): MediaIntegrationAdapterResult => ({
	failures: [],
	entityGroups: [
		{
			itemIndex: 0,
			collectionMemberships: [],
			entityRef: input.entityRef,
			events: [
				{
					eventSchemaSlug: "progress",
					occurredAt: input.occurredAt,
					...(input.unresolvedEpisode ? { unresolvedEpisode: input.unresolvedEpisode } : {}),
					properties: { consumedOn: input.consumedOn, progressPercent: input.progressPercent },
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

export const jsonRecord = (value: string) => {
	const parsed = asRecord(JSON.parse(value));
	if (parsed === null) {
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
		const record = asRecord(current);
		if (record !== null) {
			const entries = Object.entries(record);
			for (const key of keys) {
				const match = entries.find(
					([name, value]) => value != null && name.toLowerCase() === key.toLowerCase(),
				);
				if (match) {
					return match[1];
				}
			}
		}
		pending.push(...Object.values(current));
	}
	return undefined;
};

export const textValue = (value: unknown) => {
	if (typeof value === "string") {
		return value.trim() || undefined;
	}
	if (typeof value === "number") {
		return String(value);
	}
	return undefined;
};

export const nestedString = (input: unknown, keys: string[]) => textValue(nested(input, keys));

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

export const pathValue = (input: unknown, path: string[]) =>
	path.reduce<unknown>((current, key) => {
		const record = asRecord(current);
		return record === null
			? undefined
			: Object.entries(record).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
	}, input);

export const firstPathText = (payload: unknown, paths: string[][]) =>
	paths.map((path) => textValue(pathValue(payload, path))).find(Boolean);

export const truthy = (value: unknown) =>
	value === true ||
	(typeof value === "number" && value !== 0) ||
	(typeof value === "string" && ["1", "y", "yes", "true"].includes(value.trim().toLowerCase()));

export const requestJson = (
	host: Pick<ScriptHost, "httpCall">,
	method: string,
	url: string,
	options?: { body?: string; headers?: Record<string, string> },
) =>
	host
		.httpCall(method, url, options)
		.pipe(
			Effect.flatMap((response) =>
				Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(response.body),
			),
		);

export const baseUrl = (value: unknown) =>
	typeof value === "string" ? value.trim().replace(/\/$/, "") : "";
