import { getOccurredAtValue } from "./dates";
import type { ImportMediaEntityGroupBuilder } from "./groups";
import type { ImportMediaEvent, MediaImportAdapterFailure } from "./schemas";

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

export const normalizeIsbn = (value: string) => {
	const trimmed = value.trim();
	const withoutFormula =
		trimmed.startsWith('="') && trimmed.endsWith('"') ? trimmed.slice(2, -1) : trimmed;
	return withoutFormula.toUpperCase().replace(/[^0-9X]/g, "");
};

export const normalizeReadCount = (value: string) => {
	const parsed = Number.parseInt(value.trim(), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const isValidIsbn10 = (value: string) =>
	/^\d{9}[\dX]$/.test(value) &&
	value.split("").reduce((total, char, index) => {
		const digit = char === "X" ? 10 : Number.parseInt(char, 10);
		return total + digit * (10 - index);
	}, 0) %
		11 ===
		0;

const isValidIsbn13 = (value: string) => {
	if (!/^\d{13}$/.test(value)) {
		return false;
	}
	const checksum = value
		.slice(0, 12)
		.split("")
		.reduce(
			(total, char, index) => total + Number.parseInt(char, 10) * (index % 2 === 0 ? 1 : 3),
			0,
		);
	return (10 - (checksum % 10)) % 10 === Number.parseInt(value[12] ?? "", 10);
};

export const isValidIsbn = (value: string) =>
	value.length === 10 ? isValidIsbn10(value) : value.length === 13 && isValidIsbn13(value);

export const normalizeRating = (value: string) => {
	const parsed = Number.parseFloat(value.trim());
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return null;
	}
	let normalized = parsed;
	if (parsed <= 5) {
		normalized = parsed * 20;
	} else if (parsed <= 10) {
		normalized = parsed * 10;
	}
	return Math.round(Math.min(100, normalized) * 100) / 100;
};

const normalizeLifecycleValue = (value: string) =>
	value
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, "-");

export const normalizeLifecycleStatus = (value: string) => {
	const normalized = normalizeLifecycleValue(value);
	if (["read", "completed", "complete", "finished"].includes(normalized)) {
		return "complete" as const;
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
		return "progress" as const;
	}
	if (
		["watchlist", "want-to-read", "toread", "to-read", "planned", "backlog", "wanttoread"].includes(
			normalized,
		)
	) {
		return "backlog" as const;
	}
	if (["dropped", "dnf", "did-not-finish", "didnotfinish"].includes(normalized)) {
		return "dropped" as const;
	}
	if (["on-hold", "onhold", "paused", "pause"].includes(normalized)) {
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
	eventSchemaSlug: "progress",
	properties: { progressPercent: 1 },
});

export const createDroppedEvent = (input: {
	occurredAt: string;
	startedOn?: string | null;
}): ImportMediaEvent => ({
	eventSchemaSlug: "dropped",
	occurredAt: input.occurredAt,
	properties: { ...(input.startedOn ? { startedOn: input.startedOn } : {}), progressPercent: 1 },
});

export const createOnHoldEvent = (input: {
	occurredAt: string;
	startedOn?: string | null;
}): ImportMediaEvent => ({
	eventSchemaSlug: "on_hold",
	occurredAt: input.occurredAt,
	properties: { ...(input.startedOn ? { startedOn: input.startedOn } : {}), progressPercent: 1 },
});

export const createCompleteEvent = (input: {
	occurredAt: string;
	startedOn?: string | null;
	completedOn?: string | null;
}): ImportMediaEvent => ({
	occurredAt: input.occurredAt,
	eventSchemaSlug: "complete",
	properties: {
		...(input.startedOn ? { startedOn: input.startedOn } : {}),
		...(input.completedOn
			? { completedOn: input.completedOn, completionMode: "custom_timestamps" }
			: { completionMode: "unknown" }),
	},
});

export const createReviewEvent = (input: {
	text?: string | null;
	rating?: number | null;
	isSpoiler?: boolean;
	occurredAt: string;
}): ImportMediaEvent | null => {
	const text = input.text?.trim() ?? "";
	return input.rating == null && !text
		? null
		: {
				occurredAt: input.occurredAt,
				eventSchemaSlug: "review",
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

export const batchMediaImportResult = (
	result: {
		totalItems: number;
		failures: MediaImportAdapterFailure[];
		entityGroups: ReadonlyArray<ImportMediaEntityGroupBuilder>;
	},
	start: number,
	limit: number,
) => ({
	totalItems: result.totalItems,
	failures: result.failures.filter(
		({ itemIndex }) => itemIndex >= start && itemIndex < start + limit,
	),
	entityGroups: result.entityGroups.filter(
		({ itemIndex }) => itemIndex >= start && itemIndex < start + limit,
	),
});
