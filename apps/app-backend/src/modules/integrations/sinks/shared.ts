import type {
	MediaImportAdapterFailure,
	MediaImportAdapterResult,
} from "#modules/imports/media/import-processor";
import type { ImportEntityRef } from "#modules/imports/media/types";

import type { IntegrationRecord } from "../repository";

type JsonRecord = Record<string, unknown>;

export type SinkParserInput = {
	rawBody: string;
	contentType: string;
	integration: IntegrationRecord;
};

export type SinkParser = (input: SinkParserInput) => MediaImportAdapterResult;

const isJsonRecord = (value: unknown): value is JsonRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const emptySinkResult = (): MediaImportAdapterResult => ({ failures: [], entityGroups: [] });

export const createSinkFailure = (input: {
	message: string;
	context?: Record<string, unknown>;
	stage: MediaImportAdapterFailure["stage"];
}): MediaImportAdapterFailure => ({
	itemIndex: 0,
	stage: input.stage,
	message: input.message,
	...(input.context ? { context: input.context } : {}),
});

export const parseJsonRecord = (rawBody: string): JsonRecord => {
	const parsed: unknown = JSON.parse(rawBody);
	if (!isJsonRecord(parsed)) {
		throw new Error("Webhook payload is not a JSON object");
	}
	return parsed;
};

export const findNestedValue = (input: unknown, keys: string[]): unknown => {
	const pending: unknown[] = [input];
	const visited = new Set<object>();

	while (pending.length > 0) {
		const current = pending.shift();
		if (Array.isArray(current)) {
			for (const value of current) {
				if (typeof value === "object" && value !== null && !visited.has(value)) {
					visited.add(value);
					pending.push(value);
				}
			}
			continue;
		}

		if (!isJsonRecord(current)) {
			continue;
		}

		for (const key of keys) {
			const value = current[key];
			if (value !== undefined && value !== null) {
				return value;
			}
		}

		for (const value of Object.values(current)) {
			if (typeof value === "object" && value !== null && !visited.has(value)) {
				visited.add(value);
				pending.push(value);
			}
		}
	}

	return undefined;
};

export const getNestedString = (input: unknown, keys: string[]): string | undefined => {
	const value = findNestedValue(input, keys);
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : undefined;
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		return String(value);
	}
	return undefined;
};

export const getNestedNumber = (input: unknown, keys: string[]): number | undefined => {
	const value = findNestedValue(input, keys);
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}
	return undefined;
};

export const calculateProgressPercent = (
	position: number | undefined,
	duration: number | undefined,
): number | undefined => {
	if (position === undefined || duration === undefined) {
		return undefined;
	}
	if (!Number.isFinite(position) || !Number.isFinite(duration) || !duration || duration <= 0) {
		return undefined;
	}
	const ratio = (position / duration) * 100;
	return Math.max(0, Math.min(100, Math.round(ratio * 100) / 100));
};

export const createProgressResult = (input: {
	consumedOn: string;
	itemIndex?: number;
	occurredAt?: string;
	showSeason?: number;
	showEpisode?: number;
	progressPercent: number;
	entityRef: ImportEntityRef;
}): MediaImportAdapterResult => ({
	failures: [],
	entityGroups: [
		{
			collectionMemberships: [],
			entityRef: input.entityRef,
			itemIndex: input.itemIndex ?? 0,
			events: [
				{
					eventSchemaSlug: "progress",
					occurredAt: input.occurredAt ?? new Date().toISOString(),
					properties: {
						consumedOn: input.consumedOn,
						progressPercent: input.progressPercent,
						...(input.showSeason !== undefined ? { showSeason: input.showSeason } : {}),
						...(input.showEpisode !== undefined ? { showEpisode: input.showEpisode } : {}),
					},
				},
			],
		},
	],
});
