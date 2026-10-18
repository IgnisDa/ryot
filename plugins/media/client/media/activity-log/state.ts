import { localDay } from "@ryot-app/plugin-client-sdk/react";

import type { MediaActivityLogContext } from "../../../shared/activity-log-recipes";
import type { EpisodeLifecycleState } from "../../../shared/lifecycle-expressions";
import { mediaProgressPositionProperty } from "../../../shared/media-activity-fields";
import {
	MAX_ACTIVITY_EPISODES,
	type MediaActivityEntry,
	type MediaActivityLogInput,
	type MediaActivityPatch,
	type mediaActivityStatuses,
	type MediaActivityWhen,
	type MediaEventSnapshot,
} from "../../../shared/media-activity-operations";
import { mediaActivityDurationLabel, type MediaActivityEventRef } from "../activity-timeline";

type MediaActivityStatus = (typeof mediaActivityStatuses)[number];

type MediaActivityLogUnit = {
	readonly field: "pages" | "runtime" | "episodes" | "chapters";
	readonly singular: string;
	readonly plural: string;
};

type MediaActivityLogCopy = {
	readonly verb: string;
	readonly noun: string;
	readonly gerund: string;
	readonly participle: string;
};

export type MediaActivityLogger =
	| {
			readonly family: "flat";
			readonly timePrimary?: boolean;
			readonly copy: MediaActivityLogCopy;
			readonly progressUnit?: MediaActivityLogUnit;
	  }
	| {
			readonly family: "positional";
			readonly copy: MediaActivityLogCopy;
			readonly progressUnit: MediaActivityLogUnit;
	  }
	| { readonly family: "show" | "podcast"; readonly copy: MediaActivityLogCopy };

type ActivityIntent = "finished" | "progress" | "status" | "episode";

export type ActivityWhenKind = "now" | "date" | "unknown";

export type ActivityDraft = {
	readonly intent: ActivityIntent;
	readonly when: ActivityWhenKind;
	readonly finishedDay: string;
	readonly startedDay: string;
	readonly consumedOn: string;
	readonly hours: string;
	readonly minutes: string;
	readonly progressMode: "started" | "amount";
	readonly amount: string;
	readonly amountUnit: "percent" | "unit";
	readonly position: number | undefined;
	readonly status: MediaActivityStatus;
};

type ActivityWhenDraft =
	| { readonly kind: "now" }
	| { readonly kind: "unknown" }
	| { readonly kind: "date"; readonly finishedDay: string; readonly startedDay?: string };

type EntryDraftShape<Entry> = Entry extends { readonly when: MediaActivityWhen }
	? Omit<Entry, "when"> & { readonly when: ActivityWhenDraft }
	: Entry;

export type ActivityEntryDraft = EntryDraftShape<MediaActivityEntry>;

export type ActivityEpisode = {
	readonly id: string;
	readonly name: string;
	readonly episodeNumber: number;
	readonly seasonNumber: number | null;
	readonly state: EpisodeLifecycleState;
};

export const EARLIER_PAGE_LIMIT = 100;
export const EARLIER_MAX_PAGES = 5;
export const BACKFILL_LIMIT = MAX_ACTIVITY_EPISODES - 1;

const CONSUMED_ON_LIMIT = 100;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WHOLE_NUMBER = /^\d+$/;

const INTENT_LABELS: Record<ActivityIntent, string> = {
	status: "Status",
	episode: "Episode",
	progress: "Progress",
	finished: "Finished",
};

const INTENT_ORDER: Record<MediaActivityLogger["family"], readonly ActivityIntent[]> = {
	show: ["episode", "status"],
	podcast: ["episode", "status"],
	flat: ["finished", "progress", "status"],
	positional: ["progress", "finished", "status"],
};

const STATUS_COPY: Record<MediaActivityStatus, { submit: string; success: string }> = {
	on_hold: { submit: "Put on hold", success: "Put on hold." },
	dropped: { submit: "Mark as dropped", success: "Marked as dropped." },
	backlog: { submit: "Add to backlog", success: "Added to your backlog." },
};

export const activityIntents = (logger: MediaActivityLogger) =>
	INTENT_ORDER[logger.family].map((value) => ({
		value,
		label: INTENT_LABELS[value],
		content: INTENT_LABELS[value],
	}));

export const capitalized = (text: string) => `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;

const dayParts = (day: string) => {
	const match = DAY.exec(day);
	if (match === null) {
		return undefined;
	}
	const [year, month, date] = match.slice(1).map(Number);
	if (year === undefined || month === undefined || date === undefined) {
		return undefined;
	}
	const noon = new Date(year, month - 1, date, 12);
	return localDay(noon.getTime()) === day ? noon : undefined;
};

const isActivityDay = (day: string) => dayParts(day) !== undefined;

export const parseTimeSpent = (hours: string, minutes: string) => {
	const parts = [hours.trim(), minutes.trim()];
	if (parts.some((part) => part !== "" && !WHOLE_NUMBER.test(part))) {
		return null;
	}
	const [h, m] = parts.map((part) => (part === "" ? 0 : Number(part)));
	const total = (h ?? 0) * 60 + (m ?? 0);
	return total === 0 ? undefined : total;
};

const percentValue = (percent: string) => {
	const text = percent.trim();
	const value = text === "" ? Number.NaN : Number(text);
	return Number.isFinite(value) && value > 0 && value <= 100 ? value : undefined;
};

export const activityPositionTotal = (
	logger: MediaActivityLogger,
	context: MediaActivityLogContext,
) => (logger.family === "positional" ? context[logger.progressUnit.field] : null);

export const activityUnitTotal = (logger: MediaActivityLogger, context: MediaActivityLogContext) =>
	logger.family === "flat" && logger.progressUnit !== undefined
		? context[logger.progressUnit.field]
		: null;

const unitPercent = (amount: string, total: number) => {
	const text = amount.trim();
	const value = text === "" ? Number.NaN : Number(text);
	return Number.isFinite(value) && value > 0 && value <= total
		? Math.round((value / total) * 10000) / 100
		: undefined;
};

export const draftProgressPercent = (draft: ActivityDraft, total: number | null) =>
	draft.amountUnit === "unit" && total !== null
		? unitPercent(draft.amount, total)
		: percentValue(draft.amount);

export const convertedAmount = (
	draft: ActivityDraft,
	amountUnit: ActivityDraft["amountUnit"],
	total: number,
) => {
	const percent = draftProgressPercent(draft, total);
	if (percent === undefined) {
		return draft.amount;
	}
	return String(
		amountUnit === "unit" ? Math.round((percent / 100) * total) : Math.round(percent * 100) / 100,
	);
};

export const initialActivityDraft = (
	logger: MediaActivityLogger,
	context: MediaActivityLogContext,
	today: string,
): ActivityDraft => {
	const progress = context.progressPercent ?? 0;
	const total = activityPositionTotal(logger, context);
	const next = (context.position ?? 0) + 1;
	const status =
		activityStatusOptions(logger).find((option) => option.value !== context.state)?.value ??
		"backlog";
	return {
		status,
		hours: "",
		minutes: "",
		when: "now",
		startedDay: "",
		consumedOn: "",
		finishedDay: today,
		amountUnit: "percent",
		progressMode: progress > 0 ? "amount" : "started",
		intent: INTENT_ORDER[logger.family][0] ?? "finished",
		position: total === null ? next : Math.min(next, total),
		amount: progress > 0 ? String(Math.round(progress)) : "30",
	};
};

type ActivityDraftErrors = {
	readonly when?: string;
	readonly time?: string;
	readonly percent?: string;
	readonly status?: string;
	readonly position?: string;
	readonly consumedOn?: string;
};

const whenError = (draft: ActivityDraft, today: string) => {
	if (draft.when !== "date") {
		return undefined;
	}
	if (!isActivityDay(draft.finishedDay)) {
		return draft.intent === "finished" ? "Pick the day you finished." : "Pick a day.";
	}
	if (draft.finishedDay > today) {
		return "That day is in the future.";
	}
	if (draft.intent === "finished" && draft.startedDay !== "") {
		if (!isActivityDay(draft.startedDay)) {
			return "Pick a valid start day.";
		}
		if (draft.startedDay > draft.finishedDay) {
			return "The start day can't be after the finish day.";
		}
	}
	return undefined;
};

export const activityDraftErrors = (input: {
	readonly today: string;
	readonly draft: ActivityDraft;
	readonly logger: MediaActivityLogger;
	readonly context: MediaActivityLogContext;
}): ActivityDraftErrors => {
	const { draft, today, logger, context } = input;
	const errors: { -readonly [Key in keyof ActivityDraftErrors]: ActivityDraftErrors[Key] } = {};
	if (draft.intent === "status") {
		if (draft.status === context.state) {
			errors.status = "It already has this status.";
		}
		return errors;
	}
	if (draft.consumedOn.trim().length > CONSUMED_ON_LIMIT) {
		errors.consumedOn = `Keep this under ${CONSUMED_ON_LIMIT} characters.`;
	}
	if (draft.intent === "finished" || draft.intent === "episode") {
		const when = whenError(draft, today);
		if (when !== undefined) {
			errors.when = when;
		}
	}
	if (draft.intent === "finished" && parseTimeSpent(draft.hours, draft.minutes) === null) {
		errors.time = "Enter whole hours and minutes.";
	}
	if (draft.intent === "progress" && logger.family === "flat" && draft.progressMode === "amount") {
		const total = activityUnitTotal(logger, context);
		if (draftProgressPercent(draft, total) === undefined) {
			errors.percent =
				draft.amountUnit === "unit" && total !== null && logger.progressUnit !== undefined
					? `Enter ${logger.progressUnit.plural} above 0 and up to ${total}.`
					: "Enter a percent above 0 and up to 100.";
		}
	}
	if (draft.intent === "progress" && logger.family === "positional") {
		const total = activityPositionTotal(logger, context);
		const { position } = draft;
		if (position === undefined || position < 1 || (total !== null && position > total)) {
			errors.position = `Enter a ${logger.progressUnit.singular} number${total === null ? "" : ` from 1 to ${total}`}.`;
		}
	}
	return errors;
};

export const hasActivityErrors = (errors: ActivityDraftErrors) => Object.keys(errors).length > 0;

const whenDraft = (draft: ActivityDraft): ActivityWhenDraft => {
	if (draft.when === "date") {
		return {
			kind: "date",
			finishedDay: draft.finishedDay,
			...(draft.intent === "finished" && draft.startedDay !== ""
				? { startedDay: draft.startedDay }
				: {}),
		};
	}
	return { kind: draft.when };
};

export const activityEntryDraft = (input: {
	readonly entityId: string;
	readonly draft: ActivityDraft;
	readonly logger: MediaActivityLogger;
	readonly context: MediaActivityLogContext;
	readonly episodeEntityIds: readonly string[];
}): ActivityEntryDraft => {
	const { draft, entityId } = input;
	const consumedOn = draft.consumedOn.trim();
	const source = consumedOn === "" ? {} : { consumedOn };
	if (draft.intent === "status") {
		return { entityId, kind: "status", status: draft.status };
	}
	if (draft.intent === "episode") {
		return {
			...source,
			kind: "episodes",
			when: whenDraft(draft),
			parentEntityId: entityId,
			episodeEntityIds: input.episodeEntityIds,
		};
	}
	if (draft.intent === "progress") {
		const percent = draftProgressPercent(draft, activityUnitTotal(input.logger, input.context));
		return {
			...source,
			entityId,
			kind: "progress",
			...(input.logger.family === "positional" && draft.position !== undefined
				? { position: draft.position }
				: {}),
			...(input.logger.family === "flat" && draft.progressMode === "amount" && percent !== undefined
				? { progressPercent: percent }
				: {}),
		};
	}
	const timeSpent = parseTimeSpent(draft.hours, draft.minutes);
	return {
		...source,
		entityId,
		kind: "complete",
		when: whenDraft(draft),
		...(timeSpent === undefined || timeSpent === null ? {} : { timeSpent }),
	};
};

/**
 * A picked day is local noon, or the submission instant when the day is today so it never lies in
 * the future; a start never lands after its finish.
 */
export const resolveActivityWhen = (
	when: ActivityWhenDraft,
	submittedAt: string,
): MediaActivityWhen => {
	if (when.kind !== "date") {
		return { kind: when.kind };
	}
	const submitted = Date.parse(submittedAt);
	const instant = (day: string) => {
		if (day === localDay(submitted)) {
			return submitted;
		}
		return dayParts(day)?.getTime() ?? submitted;
	};
	const finished = instant(when.finishedDay);
	const started =
		when.startedDay === undefined
			? undefined
			: Math.min(dayParts(when.startedDay)?.getTime() ?? finished, finished);
	return {
		kind: "date",
		finishedOn: new Date(finished).toISOString(),
		...(started === undefined ? {} : { startedOn: new Date(started).toISOString() }),
	};
};

export const activityLogInput = (
	entry: ActivityEntryDraft,
	submission: { readonly submittedAt: string; readonly submissionId: string },
): MediaActivityLogInput => ({
	submittedAt: submission.submittedAt,
	submissionId: submission.submissionId,
	entry:
		"when" in entry
			? { ...entry, when: resolveActivityWhen(entry.when, submission.submittedAt) }
			: entry,
});

export const episodeCode = (
	logger: MediaActivityLogger,
	episode: Pick<ActivityEpisode, "episodeNumber" | "seasonNumber">,
) =>
	logger.family === "show"
		? `S${episode.seasonNumber ?? 0}·E${episode.episodeNumber}`
		: `Episode ${episode.episodeNumber}`;

export const seasonLabel = (seasonNumber: number) =>
	seasonNumber === 0 ? "Specials" : `Season ${seasonNumber}`;

export const defaultSeasonNumber = (context: {
	readonly nextUp: { readonly seasonNumber: number | null } | null;
	readonly seasons: readonly { readonly seasonNumber: number }[];
}) => {
	const seasons = context.seasons.map(({ seasonNumber }) => seasonNumber);
	const next = context.nextUp?.seasonNumber;
	if (next !== null && next !== undefined && seasons.includes(next)) {
		return next;
	}
	return seasons.find((number) => number > 0) ?? seasons[0];
};

export const selectedEpisode = (input: {
	readonly seasonNumber: number | null;
	readonly selectedId: string | undefined;
	readonly choices: readonly ActivityEpisode[];
	readonly initial: ActivityEpisode | undefined;
	readonly nextUp: Omit<ActivityEpisode, "state"> | null;
}): ActivityEpisode | undefined => {
	const { nextUp, choices, initial } = input;
	const nextUpApplies = nextUp !== null && (nextUp.seasonNumber ?? null) === input.seasonNumber;
	const id = input.selectedId ?? (nextUpApplies ? nextUp.id : choices[0]?.id);
	const listed = choices.find((choice) => choice.id === id);
	if (listed !== undefined) {
		return listed;
	}
	if (initial?.id === id) {
		return initial;
	}
	if (nextUp === null || nextUp.id !== id) {
		return undefined;
	}
	return { ...nextUp, state: "untracked", seasonNumber: nextUp.seasonNumber ?? null };
};

type ActivityQuickAction = {
	readonly text: string;
	readonly label: string;
	readonly entry: ActivityEntryDraft;
};

export const activityQuickAction = (
	logger: MediaActivityLogger,
	context: MediaActivityLogContext,
): ActivityQuickAction | null => {
	const { participle } = logger.copy;
	if (logger.family === "show" || logger.family === "podcast") {
		const { nextUp } = context;
		if (nextUp === null) {
			return null;
		}
		const code = episodeCode(logger, nextUp);
		return {
			text: `${code} ${participle}.`,
			label: `Mark ${code} ${participle}`,
			entry: {
				kind: "episodes",
				when: { kind: "now" },
				parentEntityId: context.id,
				episodeEntityIds: [nextUp.id],
			},
		};
	}
	if (logger.family === "positional") {
		const position = (context.position ?? 0) + 1;
		const total = activityPositionTotal(logger, context);
		if (context.state === "complete" || (total !== null && position > total)) {
			return null;
		}
		const { singular } = logger.progressUnit;
		return {
			label: `Mark ${singular} ${position} ${participle}`,
			text: `${capitalized(singular)} ${position} ${participle}.`,
			entry: { position, kind: "progress", entityId: context.id },
		};
	}
	return null;
};

export const episodeStateLabel = (input: {
	readonly nextUpId: string | undefined;
	readonly logger: MediaActivityLogger;
	readonly episode: Pick<ActivityEpisode, "id" | "state">;
}) => {
	if (input.episode.state === "complete") {
		return capitalized(input.logger.copy.participle);
	}
	if (input.episode.state === "in_progress") {
		return "In progress";
	}
	return input.episode.id === input.nextUpId ? "Next up" : undefined;
};

export const backfillSummary = (
	logger: MediaActivityLogger,
	earlier: readonly Pick<ActivityEpisode, "episodeNumber" | "seasonNumber">[],
) => {
	const codes = earlier.slice(0, 3).map((episode) => episodeCode(logger, episode));
	const more = earlier.length > 3 ? ` and ${earlier.length - 3} more` : "";
	return {
		detail: `${codes.join(", ")}${more} · specials never included`,
		label: `Also mark ${earlier.length} earlier un${logger.copy.participle} episode${earlier.length === 1 ? "" : "s"}`,
	};
};

export const activityCopyLabels = (input: {
	readonly episodeCount: number;
	readonly episodeCode: string | undefined;
	readonly logger: MediaActivityLogger;
	readonly draft: ActivityDraft;
	readonly name: string;
	readonly context: MediaActivityLogContext;
}) => {
	const { draft, logger } = input;
	const { gerund, participle } = logger.copy;
	if (draft.intent === "finished") {
		return {
			offerReview: true,
			submit: `Mark as ${participle}`,
			success: `${input.name} marked as ${participle}${draft.when === "unknown" ? " (date unknown)." : "."}`,
		};
	}
	if (draft.intent === "progress" && logger.family === "positional") {
		return {
			offerReview: false,
			submit: "Save progress",
			success: `Now ${participle} through ${logger.progressUnit.singular} ${draft.position ?? ""}.`,
		};
	}
	if (draft.intent === "progress") {
		const started = draft.progressMode === "started";
		return {
			offerReview: false,
			submit: started ? `Start ${gerund}` : "Save progress",
			success: started
				? `Marked as ${gerund}.`
				: `Progress saved at ${draftProgressPercent(draft, activityUnitTotal(logger, input.context)) ?? ""}%.`,
		};
	}
	if (draft.intent === "episode") {
		const many = input.episodeCount > 1;
		const code = input.episodeCode ?? "episode";
		return {
			offerReview: false,
			submit: many
				? `Mark ${input.episodeCount} episodes ${participle}`
				: `Mark ${code} ${participle}`,
			success: many
				? `${input.episodeCount} episodes marked ${participle}.`
				: `${code} marked ${participle}.`,
		};
	}
	return { offerReview: false, ...STATUS_COPY[draft.status] };
};

export const activityStatusOptions = (logger: MediaActivityLogger) =>
	[
		{ value: "backlog", label: "Backlog", detail: `Want to ${logger.copy.verb} it later` },
		{ value: "on_hold", label: "On hold", detail: "Paused for now" },
		{ value: "dropped", label: "Dropped", detail: `Stopped ${logger.copy.gerund}` },
	] as const satisfies readonly {
		readonly label: string;
		readonly detail: string;
		readonly value: MediaActivityStatus;
	}[];

export const activityStatusNote = (
	logger: MediaActivityLogger,
	context: MediaActivityLogContext,
) => {
	if (logger.family === "show" || logger.family === "podcast") {
		return "Episodes you have already marked stay as they are.";
	}
	if (logger.family === "positional") {
		return context.position === null
			? undefined
			: `Keeps your place at ${logger.progressUnit.singular} ${context.position}.`;
	}
	const progress = context.progressPercent ?? 0;
	return progress > 0 ? `Keeps your progress at ${Math.round(progress)}%.` : undefined;
};

export const activityRuntimeHint = (runtime: number | null) =>
	runtime === null
		? "Leave empty if you don't know."
		: `Leave empty to use the runtime (${mediaActivityDurationLabel(runtime)}).`;

export const consumedOnSuggestions = (userList: unknown, history: readonly string[]) => {
	const own = Array.isArray(userList)
		? userList.filter((value): value is string => typeof value === "string")
		: [];
	const seen = new Set<string>();
	return [...own, ...history].filter((value) => {
		const key = value.toLowerCase();
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
};

export type ActivityEditIntent = Extract<ActivityIntent, "finished" | "episode" | "progress">;

const numberProperty = (ref: MediaActivityEventRef, key: string | undefined) => {
	const value = key === undefined ? undefined : ref.properties[key];
	return typeof value === "number" ? value : undefined;
};

const textProperty = (ref: MediaActivityEventRef, key: string) => {
	const value = ref.properties[key];
	return typeof value === "string" ? value : undefined;
};

const dayOf = (instant: string) => localDay(Date.parse(instant));

/** The Log activity draft that shows a stored completion or progress update as it is now. */
export const activityEditDraft = (input: {
	readonly today: string;
	readonly ref: MediaActivityEventRef;
	readonly intent: ActivityEditIntent;
	readonly logger: MediaActivityLogger;
	readonly context: MediaActivityLogContext;
}): ActivityDraft => {
	const { ref } = input;
	const base = initialActivityDraft(input.logger, input.context, input.today);
	const minutes = numberProperty(ref, "timeSpent");
	const percent = numberProperty(ref, "progressPercent");
	const startedOn = textProperty(ref, "startedOn");
	const rounded = minutes === undefined ? undefined : Math.round(minutes);
	return {
		...base,
		intent: input.intent,
		amountUnit: "percent",
		finishedDay: dayOf(ref.occurredAt),
		consumedOn: textProperty(ref, "consumedOn") ?? "",
		progressMode: percent === undefined ? "started" : "amount",
		minutes: rounded === undefined ? "" : String(rounded % 60),
		startedDay: startedOn === undefined ? "" : dayOf(startedOn),
		amount: percent === undefined ? base.amount : String(percent),
		when: ref.properties["dateUnknown"] === true ? "unknown" : "date",
		hours: rounded === undefined ? "" : String(Math.floor(rounded / 60)),
		position:
			numberProperty(ref, mediaProgressPositionProperty(input.context.schemaSlug)) ?? base.position,
	};
};

const editWhen = (
	draft: ActivityDraft,
	initial: ActivityDraft,
	ref: MediaActivityEventRef,
	submittedAt: string,
): MediaActivityPatch["when"] => {
	const startedDay = draft.intent === "finished" ? draft.startedDay : "";
	const unchanged =
		draft.when === initial.when &&
		(draft.when === "unknown" ||
			(draft.finishedDay === initial.finishedDay && startedDay === initial.startedDay));
	if (unchanged) {
		return undefined;
	}
	if (draft.when === "unknown") {
		return { kind: "unknown" };
	}
	const resolved = resolveActivityWhen(
		{ kind: "date", finishedDay: draft.finishedDay, ...(startedDay === "" ? {} : { startedDay }) },
		submittedAt,
	);
	if (resolved.kind !== "date") {
		return undefined;
	}
	const keepFinished = initial.when === "date" && draft.finishedDay === initial.finishedDay;
	const finishedOn = keepFinished ? ref.occurredAt : resolved.finishedOn;
	const storedStart = textProperty(ref, "startedOn");
	const startedOn =
		startedDay !== "" && startedDay === initial.startedDay ? storedStart : resolved.startedOn;
	return {
		finishedOn,
		kind: "date",
		...(startedOn === undefined
			? {}
			: { startedOn: Date.parse(startedOn) > Date.parse(finishedOn) ? finishedOn : startedOn }),
	};
};

/** The fields the edit changed, or `undefined` when nothing differs from the stored record. */
export const activityEditPatch = (input: {
	readonly draft: ActivityDraft;
	readonly initial: ActivityDraft;
	readonly submittedAt: string;
	readonly ref: MediaActivityEventRef;
	readonly logger: MediaActivityLogger;
	readonly context: MediaActivityLogContext;
}): MediaActivityPatch | undefined => {
	const { ref, draft, initial } = input;
	const patch: { -readonly [Key in keyof MediaActivityPatch]: MediaActivityPatch[Key] } = {};
	if (draft.intent === "progress") {
		if (input.logger.family === "positional" && ref.entityId === input.context.id) {
			if (draft.position !== undefined && draft.position !== initial.position) {
				patch.position = draft.position;
			}
		} else {
			const percent =
				draft.progressMode === "amount"
					? (draftProgressPercent(draft, activityUnitTotal(input.logger, input.context)) ?? null)
					: null;
			if (percent !== (numberProperty(ref, "progressPercent") ?? null)) {
				patch.progressPercent = percent;
			}
		}
	} else {
		const when = editWhen(draft, initial, ref, input.submittedAt);
		if (when !== undefined) {
			patch.when = when;
		}
	}
	if (
		draft.intent === "finished" &&
		(draft.hours !== initial.hours || draft.minutes !== initial.minutes)
	) {
		patch.timeSpent = parseTimeSpent(draft.hours, draft.minutes) ?? null;
	}
	const consumedOn = draft.consumedOn.trim();
	if (consumedOn !== initial.consumedOn.trim()) {
		patch.consumedOn = consumedOn === "" ? null : consumedOn;
	}
	return Object.keys(patch).length === 0 ? undefined : patch;
};

/** The stored record's fields as a precondition, with every editable key it lacks marked absent. */
export const eventPrecondition = (
	ref: MediaActivityEventRef,
	editableKeys: readonly string[],
): MediaEventSnapshot => ({
	entityId: ref.entityId,
	occurredAt: ref.occurredAt,
	properties: ref.properties,
	sessionEntityId: ref.sessionEntityId,
	absentProperties: editableKeys.filter((key) => !Object.hasOwn(ref.properties, key)),
});
