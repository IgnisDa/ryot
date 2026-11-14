import { Option, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { localDay } from "@ryot-app/plugin-client-sdk/react";
import { type DurationDraft, durationDraft, parseDuration } from "@ryot-app/plugin-ui-sdk";
import { resolveDateTimeInput, toDateTimeInput } from "@ryot-app/plugin-ui-sdk/datetime";

import type { MediaActivityLogContext } from "../../../shared/activity-log-recipes";
import { MediaPosition, mediaPositionError, sameMediaPosition } from "../../../shared/consumption";
import type { EpisodeLifecycleState } from "../../../shared/lifecycle-expressions";
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

export type ActivityWhenKind = "now" | "date" | "unknown";

export type ActivityEntryDraft = EntryDraftShape<MediaActivityEntry>;

/** A local date and time in the user's time zone, written as an exact instant. */
export type ActivityTimeDraft = {
	readonly timeZone: string;
	readonly started: ActivityDateTimeDraft;
	readonly finished: ActivityDateTimeDraft;
};

export type ActivityEpisode = {
	readonly id: string;
	readonly name: string;
	readonly episodeNumber: number;
	readonly seasonNumber: null | number;
	readonly state: EpisodeLifecycleState;
};

export type MediaActivityLogger =
	| { readonly family: "show" | "podcast"; readonly copy: MediaActivityLogCopy }
	| {
			readonly family: "flat";
			readonly timePrimary?: boolean;
			readonly copy: MediaActivityLogCopy;
			readonly progressUnit?: MediaActivityLogUnit;
	  }
	| {
			readonly family: "positional";
			readonly itemContextLabel?: string;
			readonly copy: MediaActivityLogCopy;
			readonly units: readonly [MediaPositionLogUnit, ...MediaPositionLogUnit[]];
	  };

export type ActivityDraft = DurationDraft & {
	readonly amount: string;
	readonly startedDay: string;
	readonly episodeId?: string;
	readonly finishedDay: string;
	readonly item?: MediaPosition;
	readonly intent: ActivityIntent;
	readonly when: ActivityWhenKind;
	readonly status: MediaActivityStatus;
	readonly position: number | undefined;
	readonly consumedOn: readonly string[];
	readonly time: null | ActivityTimeDraft;
	readonly amountUnit: "unit" | "percent";
	readonly progressMode: "amount" | "started";
	readonly positionUnit: undefined | MediaPosition["unit"];
};

type MediaActivityStatus = (typeof mediaActivityStatuses)[number];

type ActivityIntent = "status" | "episode" | "finished" | "progress";

type PositionalLogger = Extract<MediaActivityLogger, { family: "positional" }>;

type ActivityDateTimeDraft = {
	readonly value: string;
	readonly original?: string;
	readonly occurrence?: string;
};

type MediaActivityLogUnit = {
	readonly plural: string;
	readonly singular: string;
	readonly field: "pages" | "runtime";
};

type MediaActivityLogCopy = {
	readonly verb: string;
	readonly noun: string;
	readonly gerund: string;
	readonly participle: string;
};

type MediaPositionLogUnit = {
	readonly label: string;
	readonly plural: string;
	readonly singular: string;
	readonly value: MediaPosition["unit"];
};

type EntryDraftShape<Entry> = Entry extends { readonly when: MediaActivityWhen }
	? Omit<Entry, "when"> & { readonly when: ActivityWhenDraft }
	: "when" extends keyof Entry
		? Omit<Entry, "when"> & { readonly when?: ActivityWhenDraft }
		: Entry;

type ActivityWhenDraft =
	| { readonly kind: "now" }
	| { readonly kind: "unknown" }
	| { readonly kind: "date"; readonly finishedDay: string; readonly startedDay?: string }
	| { readonly kind: "instant"; readonly finishedOn: string; readonly startedOn?: string };

export const EARLIER_PAGE_LIMIT = 100;
export const EARLIER_MAX_PAGES = 5;
export const BACKFILL_LIMIT = MAX_ACTIVITY_EPISODES - 1;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WHOLE_NUMBER = /^\d+$/;
const DECIMAL_NUMBER = /^\d+(?:\.\d+)?$/;

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

const percentValue = (percent: string) => {
	const text = percent.trim();
	const value = text === "" ? Number.NaN : Number(text);
	return Number.isFinite(value) && value > 0 && value <= 100 ? value : undefined;
};

export const activityPositionTotal = (
	context: MediaActivityLogContext,
	unit: MediaPosition["unit"],
) => context[unit];

export const positionLogUnit = (
	logger: PositionalLogger,
	unit: undefined | MediaPosition["unit"],
) => logger.units.find((candidate) => candidate.value === unit) ?? logger.units[0];

export const latestPositionIn = (context: MediaActivityLogContext, unit: MediaPosition["unit"]) =>
	context.position?.unit === unit ? context.position.position : 0;

/** The next entry in `unit`: one past the latest position in that unit, capped at its total. */
export const nextActivityPosition = (
	context: MediaActivityLogContext,
	unit: MediaPosition["unit"],
) => {
	const next = latestPositionIn(context, unit) + 1;
	const total = activityPositionTotal(context, unit);
	return total === null ? next : Math.min(next, total);
};

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

export const draftProgressPercent = (draft: ActivityDraft, total: null | number) => {
	if (draft.amountUnit === "unit") {
		return total === null ? undefined : unitPercent(draft.amount, total);
	}
	return percentValue(draft.amount);
};

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
	const positionUnit =
		logger.family === "positional"
			? positionLogUnit(logger, context.position?.unit).value
			: undefined;
	const status =
		activityStatusOptions(logger).find((option) => option.value !== context.state)?.value ??
		"backlog";
	return {
		status,
		time: null,
		when: "now",
		positionUnit,
		...durationDraft(undefined),
		startedDay: "",
		consumedOn: [],
		finishedDay: today,
		amountUnit: "percent",
		progressMode: progress > 0 ? "amount" : "started",
		intent: INTENT_ORDER[logger.family][0] ?? "finished",
		amount: progress > 0 ? String(Math.round(progress)) : "30",
		position: positionUnit === undefined ? undefined : nextActivityPosition(context, positionUnit),
	};
};

type ActivityDraftErrors = {
	readonly when?: string;
	readonly time?: string;
	readonly status?: string;
	readonly percent?: string;
	readonly position?: string;
};

/** Switches dated fields to local date and time inputs at the current time of day. */
export const addActivityTime = (
	draft: ActivityDraft,
	now: number,
	timeZone: string,
): Pick<ActivityDraft, "time"> => {
	const clock = toDateTimeInput(new Date(now).toISOString(), timeZone).slice(10);
	return {
		time: {
			timeZone,
			finished: { value: `${draft.finishedDay}${clock}` },
			started: { value: draft.startedDay === "" ? "" : `${draft.startedDay}${clock}` },
		},
	};
};

export const removeActivityTime = (
	draft: ActivityDraft,
): Pick<ActivityDraft, "time" | "startedDay" | "finishedDay"> => {
	const finished = draft.time?.finished.value.slice(0, 10) ?? "";
	return {
		time: null,
		finishedDay: finished === "" ? draft.finishedDay : finished,
		startedDay: draft.time?.started.value.slice(0, 10) ?? draft.startedDay,
	};
};

export const resolveActivityDateTime = (value: ActivityDateTimeDraft, timeZone: string) =>
	resolveDateTimeInput(value.value, value.original, value.occurrence, timeZone);

const timeError = (time: ActivityTimeDraft, today: string, withStart: boolean) => {
	const finished = resolveActivityDateTime(time.finished, time.timeZone);
	if (finished.iso === null) {
		return finished.error;
	}
	if (time.finished.value.slice(0, 10) > today) {
		return "That day is in the future.";
	}
	if (!withStart || time.started.value === "") {
		return undefined;
	}
	const started = resolveActivityDateTime(time.started, time.timeZone);
	if (started.iso === null) {
		return started.error;
	}
	return Date.parse(started.iso) > Date.parse(finished.iso)
		? "The start can't be after the finish."
		: undefined;
};

const whenError = (draft: ActivityDraft, today: string) => {
	if (draft.when !== "date") {
		return undefined;
	}
	if (draft.time !== null) {
		return timeError(draft.time, today, draft.intent !== "episode");
	}
	if (!isActivityDay(draft.finishedDay)) {
		return draft.intent === "finished" ? "Pick the day you finished." : "Pick a day.";
	}
	if (draft.finishedDay > today) {
		return "That day is in the future.";
	}
	if (draft.intent !== "episode" && draft.startedDay !== "") {
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
	{
		const when = whenError(draft, today);
		if (when !== undefined) {
			errors.when = when;
		}
	}
	if (
		(draft.intent === "finished" || draft.intent === "progress") &&
		parseDuration(draft) === null
	) {
		errors.time = "Enter whole hours and nonnegative minutes.";
	}
	if (draft.intent === "progress" && logger.family === "flat" && draft.progressMode === "amount") {
		const total = activityUnitTotal(logger, context);
		const pages = logger.progressUnit?.field === "pages" && draft.amountUnit === "unit";
		if (pages) {
			const amount = draft.amount.trim() === "" ? Number.NaN : Number(draft.amount);
			if (!Number.isFinite(amount) || amount < 0) {
				errors.percent = "Enter a nonnegative page amount.";
			}
		} else if (draftProgressPercent(draft, total) === undefined) {
			errors.percent =
				draft.amountUnit === "unit" && logger.progressUnit !== undefined && total !== null
					? `Enter ${logger.progressUnit.plural} above 0 and up to ${total}.`
					: "Enter a percent above 0 and up to 100.";
		}
	}
	if (draft.intent === "progress" && logger.family === "positional") {
		const unit = positionLogUnit(logger, draft.positionUnit);
		const total = activityPositionTotal(context, unit.value);
		const { position } = draft;
		if (
			position === undefined ||
			position < 1 ||
			(total !== null && position > total) ||
			(unit.value === "episodes" && !Number.isInteger(position))
		) {
			errors.position = `Enter a ${unit.singular} number${total === null ? "" : ` from 1 to ${total}`}.`;
		}
	}
	if (
		draft.item !== undefined &&
		(Option.isNone(Schema.decodeOption(MediaPosition)(draft.item)) ||
			mediaPositionError(context.schemaSlug, draft.item) !== undefined)
	) {
		errors.position = "Enter a valid item number.";
	}
	return errors;
};

export const hasActivityErrors = (errors: ActivityDraftErrors) => Object.keys(errors).length > 0;

const whenDraft = (draft: ActivityDraft): ActivityWhenDraft => {
	if (draft.when === "date" && draft.time !== null) {
		const { time } = draft;
		const started =
			draft.intent === "episode" || time.started.value === ""
				? null
				: resolveActivityDateTime(time.started, time.timeZone).iso;
		return {
			kind: "instant",
			finishedOn: resolveActivityDateTime(time.finished, time.timeZone).iso ?? "",
			...(started === null ? {} : { startedOn: started }),
		};
	}
	if (draft.when === "date") {
		return {
			kind: "date",
			finishedDay: draft.finishedDay,
			...(draft.intent !== "episode" && draft.startedDay !== ""
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
	const source = draft.consumedOn.length === 0 ? {} : { consumedOn: draft.consumedOn };
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
		const pages =
			input.logger.family === "flat" &&
			input.logger.progressUnit?.field === "pages" &&
			draft.amountUnit === "unit" &&
			draft.progressMode === "amount";
		const percent = pages
			? undefined
			: draftProgressPercent(draft, activityUnitTotal(input.logger, input.context));
		const timeSpent = parseDuration(draft);
		return {
			...source,
			entityId,
			kind: "progress",
			when: whenDraft(draft),
			...(timeSpent === undefined || timeSpent === null ? {} : { timeSpent }),
			...(pages ? { progressPages: Number(draft.amount) } : {}),
			...(input.logger.family === "positional" && draft.position !== undefined
				? {
						position: {
							position: draft.position,
							unit: positionLogUnit(input.logger, draft.positionUnit).value,
						},
					}
				: {}),
			...(!pages &&
			input.logger.family === "flat" &&
			draft.progressMode === "amount" &&
			percent !== undefined
				? { progressPercent: percent }
				: {}),
		};
	}
	const timeSpent = parseDuration(draft);
	return {
		...source,
		entityId,
		kind: "complete",
		when: whenDraft(draft),
		...(timeSpent === undefined || timeSpent === null ? {} : { timeSpent }),
	};
};

export const resolveActivityWhen = (
	when: ActivityWhenDraft,
	submittedAt: string,
): MediaActivityWhen => {
	if (when.kind === "instant") {
		const finishedOn = Math.min(Date.parse(when.finishedOn), Date.parse(submittedAt));
		const startedOn =
			when.startedOn === undefined ? undefined : Math.min(Date.parse(when.startedOn), finishedOn);
		return {
			kind: "date",
			finishedOn: new Date(finishedOn).toISOString(),
			...(startedOn === undefined ? {} : { startedOn: new Date(startedOn).toISOString() }),
		};
	}
	if (when.kind !== "date") {
		return { kind: when.kind };
	}
	const finished = Math.min(
		Date.parse(`${when.finishedDay}T00:00:00.000Z`),
		Date.parse(submittedAt),
	);
	const started =
		when.startedDay === undefined
			? undefined
			: Math.min(Date.parse(`${when.startedDay}T00:00:00.000Z`), finished);
	return {
		kind: "date",
		calendarDate: when.finishedDay,
		finishedOn: new Date(finished).toISOString(),
		...(started === undefined ? {} : { startedOn: new Date(started).toISOString() }),
	};
};

export const activityLogInput = (
	entry: ActivityEntryDraft,
	submission: { readonly submittedAt: string; readonly submissionId: string },
): MediaActivityLogInput => {
	if (entry.kind === "status") {
		return { ...submission, entry };
	}
	return {
		...submission,
		entry: {
			...entry,
			when: resolveActivityWhen(entry.when ?? { kind: "now" }, submission.submittedAt),
		},
	};
};

export const episodeCode = (
	logger: Pick<MediaActivityLogger, "family">,
	episode: Pick<ActivityEpisode, "seasonNumber" | "episodeNumber">,
) =>
	logger.family === "show"
		? `S${episode.seasonNumber ?? 0}·E${episode.episodeNumber}`
		: `Episode ${episode.episodeNumber}`;

export const seasonLabel = (seasonNumber: number) =>
	seasonNumber === 0 ? "Specials" : `Season ${seasonNumber}`;

export const defaultSeasonNumber = (context: {
	readonly seasons: readonly { readonly seasonNumber: number }[];
	readonly nextUp: null | { readonly seasonNumber: null | number };
}) => {
	const seasons = context.seasons.map(({ seasonNumber }) => seasonNumber);
	const next = context.nextUp?.seasonNumber;
	if (next !== null && next !== undefined) {
		return next;
	}
	return seasons.find((number) => number > 0) ?? seasons[0];
};

export const selectedEpisode = (input: {
	readonly seasonNumber: null | number;
	readonly selectedId: string | undefined;
	readonly choices: readonly ActivityEpisode[];
	readonly initial: undefined | ActivityEpisode;
	readonly nextUp: null | Omit<ActivityEpisode, "state">;
}): undefined | ActivityEpisode => {
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
): null | ActivityQuickAction => {
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
		const unit = positionLogUnit(logger, context.position?.unit);
		const position = latestPositionIn(context, unit.value) + 1;
		const total = activityPositionTotal(context, unit.value);
		if (context.state === "complete" || (total !== null && position > total)) {
			return null;
		}
		return {
			label: `Mark ${unit.singular} ${position} ${participle}`,
			text: `${capitalized(unit.singular)} ${position} ${participle}.`,
			entry: { kind: "progress", entityId: context.id, position: { position, unit: unit.value } },
		};
	}
	return null;
};

export const episodeStateLabel = (input: {
	readonly logger: MediaActivityLogger;
	readonly nextUpId: string | undefined;
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
	earlier: readonly Pick<ActivityEpisode, "seasonNumber" | "episodeNumber">[],
) => {
	const codes = earlier.slice(0, 3).map((episode) => episodeCode(logger, episode));
	const more = earlier.length > 3 ? ` and ${earlier.length - 3} more` : "";
	return {
		detail: `${codes.join(", ")}${more} · specials never included`,
		label: `Also mark ${earlier.length} earlier un${logger.copy.participle} episode${earlier.length === 1 ? "" : "s"}`,
	};
};

export const activityCopyLabels = (input: {
	readonly name: string;
	readonly episodeCount: number;
	readonly draft: ActivityDraft;
	readonly logger: MediaActivityLogger;
	readonly episodeCode: string | undefined;
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
			success: `Now ${participle} through ${positionLogUnit(logger, draft.positionUnit).singular} ${draft.position ?? ""}.`,
		};
	}
	if (draft.intent === "progress") {
		const started = draft.progressMode === "started";
		const pageUnit =
			logger.family === "flat" &&
			logger.progressUnit?.field === "pages" &&
			draft.amountUnit === "unit"
				? logger.progressUnit
				: undefined;
		let success: string;
		if (started) {
			success = `Marked as ${gerund}.`;
		} else if (pageUnit !== undefined) {
			success = `Progress saved at ${draft.amount} ${pageUnit.plural}.`;
		} else {
			success = `Progress saved at ${draftProgressPercent(draft, activityUnitTotal(logger, input.context)) ?? ""}%.`;
		}
		return { success, offerReview: false, submit: started ? `Start ${gerund}` : "Save progress" };
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
			: `Keeps your place at ${positionLogUnit(logger, context.position.unit).singular} ${context.position.position}.`;
	}
	const progress = context.progressPercent ?? 0;
	return progress > 0 ? `Keeps your progress at ${Math.round(progress)}%.` : undefined;
};

export const activityRuntimeHint = (runtime: null | number) =>
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

export type ActivityEditIntent = Extract<ActivityIntent, "episode" | "finished" | "progress">;

const numberProperty = (ref: MediaActivityEventRef, key: string) => {
	const value = ref.properties[key];
	return typeof value === "number" ? value : undefined;
};

const storedPosition = (ref: MediaActivityEventRef) =>
	Option.getOrUndefined(Schema.decodeUnknownOption(MediaPosition)(ref.properties["position"]));

export const parsePositionNumber = (unit: MediaPosition["unit"], text: string) =>
	(unit === "episodes" ? WHOLE_NUMBER : DECIMAL_NUMBER).test(text) ? Number(text) : undefined;

const textListProperty = (ref: MediaActivityEventRef, key: string) => {
	const value = ref.properties[key];
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
};

const textProperty = (ref: MediaActivityEventRef, key: string) => {
	const value = ref.properties[key];
	return typeof value === "string" ? value : undefined;
};

const dayOf = (instant: string) => localDay(Date.parse(instant));

/** The Log activity draft that shows a stored completion or progress update as it is now. */
export const activityEditDraft = (input: {
	readonly today: string;
	readonly timeZone: string;
	readonly ref: MediaActivityEventRef;
	readonly intent: ActivityEditIntent;
	readonly logger: MediaActivityLogger;
	readonly context: MediaActivityLogContext;
}): ActivityDraft => {
	const { ref } = input;
	const base = initialActivityDraft(input.logger, input.context, input.today);
	const minutes = numberProperty(ref, "timeSpent");
	const percent = numberProperty(ref, "progressPercent");
	const pages = numberProperty(ref, "progressPages");
	const amount = pages ?? percent;
	const startedOn = textProperty(ref, "startedOn");
	const calendarDate = textProperty(ref, "calendarDate");
	const stored = storedPosition(ref);
	const instant = (original: string): ActivityDateTimeDraft => ({
		original,
		value: toDateTimeInput(original, input.timeZone),
	});
	return {
		...base,
		...(input.intent === "finished" && stored !== undefined ? { item: stored } : {}),
		...(ref.entityId !== input.context.id &&
		(input.logger.family === "show" || input.logger.family === "podcast")
			? { episodeId: ref.entityId }
			: {}),
		intent: input.intent,
		position: stored?.position ?? base.position,
		positionUnit:
			input.intent === "progress" ? (stored?.unit ?? base.positionUnit) : base.positionUnit,
		...durationDraft(minutes),
		consumedOn: textListProperty(ref, "consumedOn"),
		finishedDay: calendarDate ?? dayOf(ref.occurredAt),
		amountUnit: pages === undefined ? "percent" : "unit",
		startedDay: startedOn === undefined ? "" : dayOf(startedOn),
		amount: amount === undefined ? base.amount : String(amount),
		when: ref.properties["dateUnknown"] === true ? "unknown" : "date",
		progressMode: percent === undefined && pages === undefined ? "started" : "amount",
		time:
			calendarDate === undefined && ref.properties["dateUnknown"] !== true
				? {
						timeZone: input.timeZone,
						finished: instant(ref.occurredAt),
						started: startedOn === undefined ? { value: "" } : instant(startedOn),
					}
				: null,
	};
};

const sameTime = (left: null | ActivityTimeDraft, right: null | ActivityTimeDraft) =>
	left === right ||
	(left !== null &&
		right !== null &&
		[left.started, left.finished].every((value, index) => {
			const other = index === 0 ? right.started : right.finished;
			return value.value === other.value && value.occurrence === other.occurrence;
		}));

const editWhen = (
	draft: ActivityDraft,
	initial: ActivityDraft,
	ref: MediaActivityEventRef,
	submittedAt: string,
): MediaActivityPatch["when"] => {
	const startedDay = draft.intent === "episode" ? "" : draft.startedDay;
	const unchanged =
		draft.when === initial.when &&
		(draft.when === "unknown" ||
			(sameTime(draft.time, initial.time) &&
				(draft.time !== null ||
					(draft.finishedDay === initial.finishedDay && startedDay === initial.startedDay))));
	if (unchanged) {
		return undefined;
	}
	if (draft.when === "unknown") {
		return { kind: "unknown" };
	}
	if (draft.time !== null) {
		const resolved = resolveActivityWhen(whenDraft(draft), submittedAt);
		return resolved.kind === "date" ? resolved : undefined;
	}
	const resolved = resolveActivityWhen(
		{ kind: "date", finishedDay: draft.finishedDay, ...(startedDay === "" ? {} : { startedDay }) },
		submittedAt,
	);
	if (resolved.kind !== "date") {
		return undefined;
	}
	const keepFinished =
		initial.when === "date" && initial.time === null && draft.finishedDay === initial.finishedDay;
	const finishedOn = keepFinished ? ref.occurredAt : resolved.finishedOn;
	const startedOn =
		startedDay !== "" && startedDay === initial.startedDay && initial.time === null
			? textProperty(ref, "startedOn")
			: resolved.startedOn;
	return {
		finishedOn,
		kind: "date",
		calendarDate: draft.finishedDay,
		...(startedOn === undefined
			? {}
			: { startedOn: Date.parse(startedOn) > Date.parse(finishedOn) ? finishedOn : startedOn }),
	};
};

/** The fields the edit changed, or `undefined` when nothing differs from the stored record. */
export const activityEditPatch = (input: {
	readonly submittedAt: string;
	readonly draft: ActivityDraft;
	readonly initial: ActivityDraft;
	readonly ref: MediaActivityEventRef;
	readonly logger: MediaActivityLogger;
	readonly context: MediaActivityLogContext;
}): undefined | MediaActivityPatch => {
	const { ref, draft, initial } = input;
	const patch: { -readonly [Key in keyof MediaActivityPatch]: MediaActivityPatch[Key] } = {};
	if (draft.item !== undefined && !sameMediaPosition(draft.item, initial.item)) {
		patch.position = draft.item;
	}
	if (draft.episodeId !== undefined && draft.episodeId !== initial.episodeId) {
		patch.episodeEntityId = draft.episodeId;
	}
	if (draft.intent === "progress") {
		if (input.logger.family === "positional" && ref.entityId === input.context.id) {
			const unit = positionLogUnit(input.logger, draft.positionUnit).value;
			const stored = storedPosition(ref);
			if (
				draft.position !== undefined &&
				(draft.position !== initial.position || draft.positionUnit !== initial.positionUnit)
			) {
				patch.position = {
					...(stored?.unit === unit && stored.position === draft.position ? stored : {}),
					unit,
					position: draft.position,
				};
			}
		} else {
			const pages =
				input.logger.family === "flat" &&
				input.logger.progressUnit?.field === "pages" &&
				draft.amountUnit === "unit" &&
				draft.progressMode === "amount";
			const percent =
				!pages && draft.progressMode === "amount"
					? (draftProgressPercent(draft, activityUnitTotal(input.logger, input.context)) ?? null)
					: null;
			if (percent !== (numberProperty(ref, "progressPercent") ?? null)) {
				patch.progressPercent = percent;
			}
			const progressPages = pages ? Number(draft.amount) : null;
			if (progressPages !== (numberProperty(ref, "progressPages") ?? null)) {
				patch.progressPages = progressPages;
			}
		}
	}
	{
		const when = editWhen(draft, initial, ref, input.submittedAt);
		if (when !== undefined) {
			patch.when = when;
		}
	}
	if (
		(draft.intent === "finished" || draft.intent === "progress") &&
		(draft.hours !== initial.hours || draft.minutes !== initial.minutes)
	) {
		patch.timeSpent = parseDuration(draft) ?? null;
	}
	if (
		draft.consumedOn.length !== initial.consumedOn.length ||
		draft.consumedOn.some((value, index) => value !== initial.consumedOn[index])
	) {
		patch.consumedOn = draft.consumedOn.length === 0 ? null : draft.consumedOn;
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
