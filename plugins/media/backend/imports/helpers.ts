import { getOccurredAtValue } from "./dates";
import type { ImportMediaEntityGroupBuilder } from "./groups";
import type { ImportMediaEvent } from "./schemas";

export const assertRequiredHeaders = (
	headers: string[],
	requiredHeaders: string[],
	sourceName: string,
) => {
	if (headers.length === 0) {
		throw new Error(`${sourceName} CSV is empty or has no header row`);
	}
	const missing = requiredHeaders.filter((header) => !headers.includes(header));
	if (missing.length > 0) {
		throw new Error(`${sourceName} CSV is missing required columns: ${missing.join(", ")}`);
	}
};

export const addCollectionMembership = (
	group: ImportMediaEntityGroupBuilder,
	collectionName: string,
) => {
	const trimmed = collectionName.trim();
	if (
		trimmed &&
		!group.collectionMemberships.some((membership) => membership.collectionName === trimmed)
	) {
		group.collectionMemberships.push({ collectionName: trimmed });
	}
};

export const splitCommaList = (value: string) =>
	value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

export const normalizeBoolean = (value: string) => value.trim().toLowerCase() === "true";

export const normalizeReadCount = (value: string) => {
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
};

export const normalizeRating = (value: string, sourceScale: 5 | 10 | 100) => {
	const parsed = Number.parseFloat(value.trim());
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return null;
	}
	const normalized = (parsed / sourceScale) * 100;
	return Math.round(Math.min(100, normalized) * 100) / 100;
};

const normalizeLifecycleValue = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, "-");

export const normalizeLifecycleStatus = (value: string) => {
	const normalized = normalizeLifecycleValue(value);
	if (["read", "complete", "finished", "completed"].includes(normalized)) {
		return "complete" as const;
	}
	if (
		[
			"current",
			"reading",
			"progress",
			"inprogress",
			"in-progress",
			"currentlyreading",
			"currently-reading",
		].includes(normalized)
	) {
		return "progress" as const;
	}
	if (
		["toread", "to-read", "planned", "backlog", "watchlist", "wanttoread", "want-to-read"].includes(
			normalized,
		)
	) {
		return "backlog" as const;
	}
	if (["dnf", "dropped", "didnotfinish", "did-not-finish"].includes(normalized)) {
		return "dropped" as const;
	}
	if (["pause", "onhold", "paused", "on-hold"].includes(normalized)) {
		return "on_hold" as const;
	}
	return undefined;
};

export const isLifecycleAlias = (value: string) => normalizeLifecycleStatus(value) !== undefined;

export const toTitleCaseWords = (value: string) =>
	value
		.trim()
		.replace(/[_-]+/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
		.join(" ");

export const createBacklogEvent = (occurredAt: string): ImportMediaEvent => ({
	occurredAt,
	properties: {},
	eventSchemaSlug: "backlog",
});

export const createProgressEvent = (occurredAt: string): ImportMediaEvent => ({
	occurredAt,
	properties: {},
	eventSchemaSlug: "progress",
});

export const createDroppedEvent = (input: {
	occurredAt: string;
	startedOn?: null | string;
}): ImportMediaEvent => ({
	eventSchemaSlug: "dropped",
	occurredAt: input.occurredAt,
	properties: input.startedOn ? { startedOn: input.startedOn } : {},
});

export const createOnHoldEvent = (input: {
	occurredAt: string;
	startedOn?: null | string;
}): ImportMediaEvent => ({
	eventSchemaSlug: "on_hold",
	occurredAt: input.occurredAt,
	properties: input.startedOn ? { startedOn: input.startedOn } : {},
});

export const createCompleteEvent = (input: {
	occurredAt: string;
	dateUnknown?: boolean;
	startedOn?: null | string;
}): ImportMediaEvent => ({
	eventSchemaSlug: "complete",
	occurredAt: input.occurredAt,
	properties: {
		...(input.startedOn ? { startedOn: input.startedOn } : {}),
		...(input.dateUnknown ? { dateUnknown: true } : {}),
	},
});

export const createReviewEvent = (input: {
	occurredAt: string;
	isSpoiler?: boolean;
	text?: null | string;
	rating?: null | number;
}): null | ImportMediaEvent => {
	const text = input.text?.trim() ?? "";
	return input.rating == null && !text
		? null
		: {
				eventSchemaSlug: "review",
				occurredAt: input.occurredAt,
				properties: {
					...(text ? { text } : {}),
					...(input.rating == null ? {} : { rating: input.rating }),
					...(input.isSpoiler === undefined ? {} : { isSpoiler: input.isSpoiler }),
				},
			};
};

export const finalizeEntityGroups = (groups: Iterable<ImportMediaEntityGroupBuilder>) => {
	const finalized: ImportMediaEntityGroupBuilder[] = [];
	for (const group of groups) {
		finalized.push({
			...group,
			events: [...group.events].sort(
				(left, right) => getOccurredAtValue(left.occurredAt) - getOccurredAtValue(right.occurredAt),
			),
		});
	}
	return finalized;
};
