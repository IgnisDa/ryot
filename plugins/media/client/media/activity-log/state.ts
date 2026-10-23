import type { MediaActivityLogContext } from "../../../shared/activity-log-recipes";
import type { EpisodeLifecycleState } from "../../../shared/lifecycle-expressions";
import {
	MAX_ACTIVITY_EPISODES,
	type MediaActivityEntry,
	type MediaActivityLogInput,
	type mediaActivityStatuses,
	type MediaActivityWhen,
} from "../../../shared/media-activity-operations";
import { mediaActivityDurationLabel } from "../activity-timeline";
import { type MediaWatchProviders, viewerRegion, watchProviderGroups } from "../watch-providers";

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
	readonly percent: string;
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

const twoDigits = (value: number) => String(value).padStart(2, "0");

export const localDay = (time: number) => {
	const date = new Date(time);
	return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
};

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

export const percentFromUnit = (value: string, total: number) => {
	const text = value.trim();
	const amount = text === "" ? Number.NaN : Number(text);
	if (!Number.isFinite(amount) || amount <= 0 || total <= 0) {
		return undefined;
	}
	return String(Math.min(100, Math.round((amount / total) * 10000) / 100));
};

export const unitFromPercent = (percent: string, total: number) => {
	const value = percentValue(percent);
	return value === undefined ? "" : String(Math.round((value / 100) * total));
};

export const initialActivityDraft = (
	logger: MediaActivityLogger,
	context: MediaActivityLogContext,
	today: string,
): ActivityDraft => {
	const progress = context.progressPercent ?? 0;
	const total = activityPositionTotal(logger, context);
	const next = (context.position ?? 0) + 1;
	return {
		hours: "",
		minutes: "",
		when: "now",
		startedDay: "",
		consumedOn: "",
		status: "backlog",
		finishedDay: today,
		progressMode: progress > 0 ? "amount" : "started",
		intent: INTENT_ORDER[logger.family][0] ?? "finished",
		position: total === null ? next : Math.min(next, total),
		percent: progress > 0 ? String(Math.round(progress)) : "30",
	};
};

type ActivityDraftErrors = {
	readonly when?: string;
	readonly time?: string;
	readonly percent?: string;
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
	if (
		draft.intent === "progress" &&
		logger.family === "flat" &&
		draft.progressMode === "amount" &&
		percentValue(draft.percent) === undefined
	) {
		errors.percent = "Enter a percent above 0 and up to 100.";
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
		const percent = percentValue(draft.percent);
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
			success: started ? `Marked as ${gerund}.` : `Progress saved at ${draft.percent.trim()}%.`,
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

export const activitySources = (context: MediaActivityLogContext) => {
	const providers = watchProviderGroups(
		{ watchProviders: context.watchProviders } satisfies MediaWatchProviders,
		viewerRegion(),
	)
		.filter((group) => group.offer === "stream")
		.flatMap((group) => group.providers.map((provider) => provider.name));
	return [...context.consumedOn, ...providers].filter(
		(value, index, all) => all.indexOf(value) === index,
	);
};

export const activityRuntimeHint = (runtime: number | null) =>
	runtime === null
		? "Leave empty if you don't know."
		: `Leave empty to use the runtime (${mediaActivityDurationLabel(runtime)}).`;
