import { dayjs } from "@ryot/ts-utils/dayjs";

import type { ImportMediaEvent, ImportMediaEntityGroup } from "../../jobs";

const getOccurredAtValue = (value: string): number => {
	const occurredAt = dayjs(value).valueOf();
	return Number.isFinite(occurredAt) ? occurredAt : 0;
};

export const assertRequiredHeaders = (
	headers: string[],
	requiredHeaders: string[],
	sourceName: string,
): void => {
	if (headers.length === 0) {
		throw new Error(`${sourceName} CSV is empty or has no header row`);
	}

	const missing = requiredHeaders.filter((header) => !headers.includes(header));
	if (missing.length > 0) {
		throw new Error(`${sourceName} CSV is missing required columns: ${missing.join(", ")}`);
	}
};

export const finalizeEntityGroups = (
	groupMap: Map<string, ImportMediaEntityGroup>,
): ImportMediaEntityGroup[] =>
	[...groupMap.values()].map((group) => ({
		entityRef: group.entityRef,
		collectionMemberships: group.collectionMemberships,
		events: [...group.events].sort(
			(a, b) => getOccurredAtValue(a.occurredAt) - getOccurredAtValue(b.occurredAt),
		),
	}));

export const addCollectionMembership = (
	group: ImportMediaEntityGroup,
	collectionName: string,
): void => {
	const trimmed = collectionName.trim();
	if (!trimmed) {
		return;
	}
	const exists = group.collectionMemberships.some(
		(membership) => membership.collectionName === trimmed,
	);
	if (!exists) {
		group.collectionMemberships.push({ collectionName: trimmed });
	}
};

export const splitCommaList = (value: string): string[] =>
	value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

export const normalizeBoolean = (value: string): boolean => value.trim().toLowerCase() === "true";

export const normalizeIsbn = (value: string): string => {
	const trimmed = value.trim();
	const withoutFormula =
		trimmed.startsWith('="') && trimmed.endsWith('"') ? trimmed.slice(2, -1) : trimmed;
	return withoutFormula.toUpperCase().replace(/[^0-9X]/g, "");
};

export const normalizeReadCount = (value: string): number => {
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const isValidIsbn10 = (value: string): boolean => {
	if (!/^\d{9}[\dX]$/.test(value)) {
		return false;
	}
	const checksum = value.split("").reduce((total, char, index) => {
		const digit = char === "X" ? 10 : Number.parseInt(char, 10);
		return total + digit * (10 - index);
	}, 0);
	return checksum % 11 === 0;
};

const isValidIsbn13 = (value: string): boolean => {
	if (!/^\d{13}$/.test(value)) {
		return false;
	}
	const checksum = value
		.slice(0, 12)
		.split("")
		.reduce((total, char, index) => {
			const digit = Number.parseInt(char, 10);
			return total + digit * (index % 2 === 0 ? 1 : 3);
		}, 0);
	const checkDigit = (10 - (checksum % 10)) % 10;
	return checkDigit === Number.parseInt(value[12] ?? "", 10);
};

export const isValidIsbn = (value: string): boolean =>
	value.length === 10 ? isValidIsbn10(value) : value.length === 13 ? isValidIsbn13(value) : false;

export const normalizeRating = (value: string): number | null => {
	const parsed = Number.parseFloat(value.trim());
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return null;
	}

	const scaled = parsed <= 5 ? parsed * 20 : parsed <= 10 ? parsed * 10 : parsed;
	return Math.round(Math.min(100, scaled) * 100) / 100;
};

export const parseDateWithFormat = (value: string, format: string): string | null => {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	const parsed = dayjs.utc(trimmed, format, true);
	return parsed.isValid() ? parsed.startOf("day").toISOString() : null;
};

export const parseDateTime = (value: string, formats: string[]): string | null => {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}

	for (const format of formats) {
		const parsed = dayjs.utc(trimmed, format, true);
		if (parsed.isValid()) {
			return parsed.toISOString();
		}
	}

	const parsed = dayjs.utc(trimmed);
	return parsed.isValid() ? parsed.toISOString() : null;
};

const normalizeLifecycleValue = (value: string): string =>
	value
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, "-");

export const normalizeLifecycleStatus = (
	value: string,
): "backlog" | "complete" | "dropped" | "on_hold" | "progress" | undefined => {
	const normalized = normalizeLifecycleValue(value);
	if (!normalized) {
		return undefined;
	}

	if (["read", "completed", "complete", "finished"].includes(normalized)) {
		return "complete";
	}

	if (
		[
			"currently-reading",
			"currentlyreading",
			"current",
			"in-progress",
			"inprogress",
			"progress",
			"reading",
		].includes(normalized)
	) {
		return "progress";
	}

	if (
		["want-to-read", "toread", "to-read", "planned", "backlog", "wanttoread"].includes(normalized)
	) {
		return "backlog";
	}

	if (["dropped", "dnf", "did-not-finish", "didnotfinish"].includes(normalized)) {
		return "dropped";
	}

	if (["on-hold", "onhold", "paused", "pause"].includes(normalized)) {
		return "on_hold";
	}

	return undefined;
};

export const isLifecycleAlias = (value: string): boolean =>
	normalizeLifecycleStatus(value) !== undefined;

export const toTitleCaseWords = (value: string): string =>
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
	eventSchemaSlug: "progress",
	properties: { progressPercent: 1 },
});

const createStateTransitionProperties = (input: {
	progressPercent?: number;
	startedOn?: string | null;
}) => ({
	...(input.startedOn ? { startedOn: input.startedOn } : {}),
	progressPercent: input.progressPercent ?? 1,
});

export const createDroppedEvent = (input: {
	occurredAt: string;
	startedOn?: string | null;
}): ImportMediaEvent => ({
	eventSchemaSlug: "dropped",
	occurredAt: input.occurredAt,
	properties: createStateTransitionProperties({ startedOn: input.startedOn }),
});

export const createOnHoldEvent = (input: {
	occurredAt: string;
	startedOn?: string | null;
}): ImportMediaEvent => ({
	eventSchemaSlug: "on_hold",
	occurredAt: input.occurredAt,
	properties: createStateTransitionProperties({ startedOn: input.startedOn }),
});

export const createCompleteEvent = (input: {
	occurredAt: string;
	startedOn?: string | null;
	completedOn?: string | null;
}): ImportMediaEvent => ({
	eventSchemaSlug: "complete",
	occurredAt: input.occurredAt,
	properties: {
		...(input.startedOn ? { startedOn: input.startedOn } : {}),
		...(input.completedOn
			? { completedOn: input.completedOn, completionMode: "custom_timestamps" }
			: { completionMode: "unknown" }),
	},
});

export const createReviewEvent = (input: {
	occurredAt: string;
	isSpoiler?: boolean;
	text?: string | null;
	rating?: number | null;
}): ImportMediaEvent | null => {
	const text = input.text?.trim() ?? "";
	if (input.rating == null && !text) {
		return null;
	}

	return {
		eventSchemaSlug: "review",
		occurredAt: input.occurredAt,
		properties: {
			...(input.rating != null ? { rating: input.rating } : {}),
			...(text ? { text } : {}),
			...(input.isSpoiler !== undefined ? { isSpoiler: input.isSpoiler } : {}),
		},
	};
};
