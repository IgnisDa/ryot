import {
	localDay,
	nextPageCursor,
	paginationItems,
	usePluginIdentity,
	usePluginUserSettings,
	useRyotInfiniteQuery,
	useRyotQuery,
	useRyotSchedule,
	useRyotSubmission,
} from "@ryot-app/plugin-client-sdk/react";
import {
	ActionForm,
	Button,
	Chip,
	Dialog,
	Field,
	FieldMessage,
	LoadMoreButton,
	RadioGroup,
	Row,
	SegmentedControl,
	Select,
	StatusMessage,
	Stepper,
	Switch,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { type ReactNode, type RefObject, useEffect, useMemo, useState } from "react";

import type { MediaActivityLogContext } from "../../../shared/activity-log-recipes";
import { consumedOnSettingKey } from "../../../shared/consumed-on-settings";
import { PLUGIN_PACKAGE_ID } from "../../../shared/plugin-identity";
import { podcastEpisodesQuery } from "../../podcast/episodes-query";
import {
	activityLogContextQuery,
	earlierUnwatchedQuery,
	logActivityMutation,
	showSeasonChoicesQuery,
} from "./queries";
import {
	activityCopyLabels,
	type ActivityDraft,
	activityDraftErrors,
	activityEntryDraft,
	type ActivityEpisode,
	activityIntents,
	activityPositionTotal,
	activityRuntimeHint,
	activityStatusNote,
	activityStatusOptions,
	activityUnitTotal,
	type ActivityWhenKind,
	BACKFILL_LIMIT,
	backfillSummary,
	capitalized,
	consumedOnSuggestions,
	convertedAmount,
	defaultSeasonNumber,
	EARLIER_MAX_PAGES,
	episodeCode,
	episodeStateLabel,
	hasActivityErrors,
	initialActivityDraft,
	type MediaActivityLogger,
	seasonLabel,
	selectedEpisode,
} from "./state";

type EpisodePager = {
	readonly isError: boolean;
	readonly retry: () => void;
	readonly isPending: boolean;
	readonly hasNextPage: boolean;
	readonly fetchNextPage: () => void;
	readonly isFetchingNextPage: boolean;
	readonly choices: readonly ActivityEpisode[];
};

type Earlier =
	| { readonly status: "none" }
	| { readonly status: "loading" }
	| { readonly status: "error"; readonly retry: () => void }
	| {
			readonly status: "ready";
			readonly tooMany: boolean;
			readonly episodes: readonly ActivityEpisode[];
	  };

type EarlierReport = { readonly episodeId: string; readonly earlier: Earlier };

const FIRST_PAGE: string | null = null;

const whenOptions = (episode: boolean) =>
	[
		{ value: "now", label: "Just now", content: "Just now" },
		{
			value: "date",
			label: episode ? "Pick date" : "Pick dates",
			content: episode ? "Pick date" : "Pick dates",
		},
		{ value: "unknown", label: "I don’t remember", content: "I don’t remember" },
	] as const satisfies readonly {
		readonly value: ActivityWhenKind;
		readonly label: string;
		readonly content: string;
	}[];

function ShowEpisodes(props: {
	readonly entityId: string;
	readonly seasonNumber: number;
	readonly children: (pager: EpisodePager) => ReactNode;
}) {
	const query = useRyotInfiniteQuery(
		showSeasonChoicesQuery,
		{ showEntityId: props.entityId, seasonNumber: props.seasonNumber },
		{
			initialPageParam: FIRST_PAGE,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after) => ({ ...input, after }),
		},
	);
	const choices = paginationItems(
		query.pages,
		(page) => page.items,
		(item) => item.id,
	).map((item) => ({
		id: item.id,
		name: item.name,
		state: item.state,
		seasonNumber: props.seasonNumber,
		episodeNumber: item.episodeNumber,
	}));
	return props.children({
		choices,
		retry: query.retry,
		isError: query.isError,
		isPending: query.isPending,
		hasNextPage: query.hasNextPage,
		fetchNextPage: query.fetchNextPage,
		isFetchingNextPage: query.isFetchingNextPage,
	});
}

function PodcastEpisodes(props: {
	readonly entityId: string;
	readonly children: (pager: EpisodePager) => ReactNode;
}) {
	const query = useRyotInfiniteQuery(
		podcastEpisodesQuery,
		{ entityId: props.entityId, containerId: props.entityId },
		{
			initialPageParam: FIRST_PAGE,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after) => ({ ...input, after }),
		},
	);
	const choices = paginationItems(
		query.pages,
		(page) => page.items,
		(item) => item.id,
	).map((item) => ({
		id: item.id,
		name: item.name,
		state: item.state,
		seasonNumber: null,
		episodeNumber: item.episodeNumber,
	}));
	return props.children({
		choices,
		retry: query.retry,
		isError: query.isError,
		isPending: query.isPending,
		hasNextPage: query.hasNextPage,
		fetchNextPage: query.fetchNextPage,
		isFetchingNextPage: query.isFetchingNextPage,
	});
}

function EarlierEpisodes(props: {
	readonly entityId: string;
	readonly episodeId: string;
	readonly kind: "show" | "podcast";
	readonly onChange: (report: EarlierReport) => void;
}) {
	const { kind, entityId, onChange, episodeId } = props;
	const query = useRyotInfiniteQuery(
		earlierUnwatchedQuery,
		{ kind, parentEntityId: entityId, episodeEntityId: episodeId },
		{
			initialPageParam: FIRST_PAGE,
			getPageInput: (input, after) => ({ ...input, after }),
			getNextPageParam: (page) => (page.hasMore ? page.nextCursor : null),
		},
	);
	const { pages, retry, isError, isPending, isFetching, hasNextPage, fetchNextPage } = query;
	const pagesLoaded = pages.length;
	useEffect(() => {
		if (hasNextPage && !isFetching && !isError && pagesLoaded < EARLIER_MAX_PAGES) {
			fetchNextPage();
		}
	}, [fetchNextPage, hasNextPage, isError, isFetching, pagesLoaded]);
	const earlier = useMemo((): Earlier => {
		if (isError) {
			return { retry, status: "error" };
		}
		if (isPending || (hasNextPage && pagesLoaded < EARLIER_MAX_PAGES)) {
			return { status: "loading" };
		}
		const episodes = paginationItems(
			pages,
			(page) => page.items,
			(item) => item.id,
		).map((item) => ({
			id: item.id,
			name: item.name,
			state: "untracked" as const,
			seasonNumber: item.seasonNumber,
			episodeNumber: item.episodeNumber,
		}));
		return { episodes, status: "ready", tooMany: episodes.length > BACKFILL_LIMIT };
	}, [hasNextPage, isError, isPending, pages, pagesLoaded, retry]);
	useEffect(() => {
		onChange({ earlier, episodeId });
	}, [earlier, episodeId, onChange]);
	return null;
}

function EpisodeList(props: {
	readonly pager: EpisodePager;
	readonly nextUpId: string | undefined;
	readonly selectedId: string | undefined;
	readonly logger: MediaActivityLogger;
	readonly onSelect: (id: string) => void;
}) {
	const { pager, logger } = props;
	if (pager.isError && pager.choices.length === 0) {
		return (
			<StatusMessage tone="error" action={{ label: "Try again", onClick: pager.retry }}>
				Unable to load episodes.
			</StatusMessage>
		);
	}
	if (pager.isPending) {
		return <StatusMessage tone="pending">Loading episodes…</StatusMessage>;
	}
	if (pager.choices.length === 0) {
		return <p className="text-text-muted">There are no episodes to log yet.</p>;
	}
	return (
		<div className="flex flex-col gap-2">
			<RadioGroup
				label="Episode"
				value={props.selectedId}
				onChange={props.onSelect}
				className="max-h-56 overflow-y-auto rounded-md border border-border"
				options={pager.choices.map((episode) => {
					const state = episodeStateLabel({ logger, episode, nextUpId: props.nextUpId });
					return {
						state,
						episode,
						value: episode.id,
						label: `${episodeCode(logger, episode)}${state === undefined ? "" : ` · ${state}`}`,
					};
				})}
				renderOption={(option, selected) => ({
					className: clsx(
						"flex min-h-11 w-full items-center justify-between gap-3 border-t border-border px-3 text-left first:border-t-0",
						selected ? "bg-accent-soft" : "hover:bg-hover",
					),
					content: (
						<>
							<span className="min-w-0 flex-1 truncate">
								<span className="font-medium text-text">{episodeCode(logger, option.episode)}</span>
								{option.episode.name === "" ? null : (
									<span className="text-text-muted"> · {option.episode.name}</span>
								)}
							</span>
							{option.state === undefined ? null : (
								<span className="shrink-0 text-xs text-text-subtle">{option.state}</span>
							)}
						</>
					),
				})}
			/>
			{pager.hasNextPage ? (
				<LoadMoreButton
					label="Load more"
					onClick={pager.fetchNextPage}
					disabled={pager.isFetchingNextPage}
					isFetchingNextPage={pager.isFetchingNextPage}
				/>
			) : null}
		</div>
	);
}

function SourceField(props: {
	readonly value: string;
	readonly error: string | undefined;
	readonly logger: MediaActivityLogger;
	readonly suggestions: readonly string[];
	readonly onChange: (value: string) => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<Field optional error={props.error} label={`Where did you ${props.logger.copy.verb} it?`}>
				{(control) => (
					<TextField
						{...control}
						type="text"
						value={props.value}
						placeholder="Service, app or format"
						onChange={(event) => props.onChange(event.currentTarget.value)}
					/>
				)}
			</Field>
			{props.suggestions.length === 0 ? null : (
				<div className="flex flex-wrap gap-1.5">
					{props.suggestions.map((suggestion) => (
						<button
							type="button"
							key={suggestion}
							onClick={() => props.onChange(suggestion)}
							aria-pressed={props.value.trim() === suggestion}
						>
							<Chip label={suggestion} checked={props.value.trim() === suggestion} />
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function TimeSpentField(props: {
	readonly label: string;
	readonly hint: string;
	readonly draft: ActivityDraft;
	readonly error: string | undefined;
	readonly onChange: (patch: Partial<ActivityDraft>) => void;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-[13px] font-medium text-text">{props.label}</span>
			<div className="flex items-center gap-2">
				<TextField
					type="text"
					placeholder="0"
					className="w-20"
					aria-label="Hours"
					inputMode="numeric"
					value={props.draft.hours}
					invalid={props.error !== undefined}
					onChange={(event) => props.onChange({ hours: event.currentTarget.value })}
				/>
				<span className="text-text-muted">h</span>
				<TextField
					type="text"
					placeholder="0"
					className="w-20"
					inputMode="numeric"
					aria-label="Minutes"
					value={props.draft.minutes}
					invalid={props.error !== undefined}
					onChange={(event) => props.onChange({ minutes: event.currentTarget.value })}
				/>
				<span className="text-text-muted">min</span>
			</div>
			{props.error === undefined ? (
				<p className="text-xs text-text-muted">{props.hint}</p>
			) : (
				<FieldMessage>{props.error}</FieldMessage>
			)}
		</div>
	);
}

function WhenField(props: {
	readonly today: string;
	readonly draft: ActivityDraft;
	readonly error: string | undefined;
	readonly logger: MediaActivityLogger;
	readonly onChange: (patch: Partial<ActivityDraft>) => void;
}) {
	const { draft, logger } = props;
	const episode = draft.intent === "episode";
	return (
		<div className="flex flex-col gap-2">
			<span className="text-[13px] font-medium text-text">
				{episode ? `When did you ${logger.copy.verb} it?` : "When did you finish it?"}
			</span>
			<SegmentedControl
				fill
				label="When"
				value={draft.when}
				optionClassName="px-3"
				options={whenOptions(episode)}
				onChange={(when) => props.onChange({ when })}
			/>
			{draft.when === "date" ? (
				<div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
					{episode ? null : (
						<Field optional label="Started">
							{(control) => (
								<TextField
									{...control}
									type="date"
									max={props.today}
									value={draft.startedDay}
									onChange={(event) => props.onChange({ startedDay: event.currentTarget.value })}
								/>
							)}
						</Field>
					)}
					<Field label={episode ? `${capitalized(logger.copy.participle)} on` : "Finished"}>
						{(control) => (
							<TextField
								{...control}
								type="date"
								max={props.today}
								value={draft.finishedDay}
								onChange={(event) => props.onChange({ finishedDay: event.currentTarget.value })}
							/>
						)}
					</Field>
				</div>
			) : null}
			{props.error === undefined ? null : <FieldMessage>{props.error}</FieldMessage>}
			{draft.when === "unknown" ? (
				<p className="text-text-muted">
					Recorded with no date. It counts toward your totals but stays off the activity calendar.
				</p>
			) : null}
		</div>
	);
}

function FlatProgress(props: {
	readonly draft: ActivityDraft;
	readonly logger: MediaActivityLogger;
	readonly error: string | undefined;
	readonly context: MediaActivityLogContext;
	readonly onChange: (patch: Partial<ActivityDraft>) => void;
}) {
	const { draft, logger, context } = props;
	const total = activityUnitTotal(logger, context);
	const unit = logger.family === "flat" ? logger.progressUnit : undefined;
	if (draft.progressMode === "started") {
		return (
			<div className="flex flex-col items-start gap-2">
				<p className="text-text-muted">
					Marks it as in progress without an amount. You can set one later.
				</p>
				<Button variant="link" onClick={() => props.onChange({ progressMode: "amount" })}>
					Add an amount
				</Button>
			</div>
		);
	}
	let hint: string | undefined;
	if (unit !== undefined && total !== null) {
		hint =
			draft.amountUnit === "unit"
				? `of ${total} ${unit.plural}`
				: `${total} ${unit.plural} in total`;
	}
	return (
		<div className="flex flex-col items-start gap-2">
			<Field hint={hint} className="w-full" error={props.error} label="How far along?">
				{(control) => (
					<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
						<TextField
							{...control}
							type="text"
							inputMode="decimal"
							value={draft.amount}
							onChange={(event) => props.onChange({ amount: event.currentTarget.value })}
						/>
						{unit === undefined || total === null ? (
							<span className="text-text-muted">%</span>
						) : (
							<SegmentedControl
								label="Unit"
								optionClassName="px-3"
								value={draft.amountUnit}
								onChange={(amountUnit) =>
									props.onChange({ amountUnit, amount: convertedAmount(draft, amountUnit, total) })
								}
								options={[
									{ content: "%", value: "percent", label: "Percent" },
									{ value: "unit", content: unit.plural, label: capitalized(unit.plural) },
								]}
							/>
						)}
					</div>
				)}
			</Field>
			<Button variant="link" onClick={() => props.onChange({ progressMode: "started" })}>
				Just started? Skip the amount
			</Button>
		</div>
	);
}

function PositionProgress(props: {
	readonly draft: ActivityDraft;
	readonly error: string | undefined;
	readonly context: MediaActivityLogContext;
	readonly logger: Extract<MediaActivityLogger, { family: "positional" }>;
	readonly onChange: (patch: Partial<ActivityDraft>) => void;
}) {
	const { draft, logger } = props;
	const total = activityPositionTotal(logger, props.context);
	const { plural, singular } = logger.progressUnit;
	const percent =
		total === null || draft.position === undefined
			? undefined
			: Math.round((draft.position / total) * 100);
	return (
		<div className="flex flex-col gap-2">
			<span className="text-[13px] font-medium text-text">
				{capitalized(logger.copy.participle)} through {singular}
			</span>
			<div className="flex items-center gap-3">
				<Stepper
					min={1}
					step={1}
					className="w-44"
					value={draft.position}
					invalid={props.error !== undefined}
					incrementIcon={<AppIcon size={16} name="plus" />}
					decrementIcon={<AppIcon size={16} name="minus" />}
					onChange={(position) => props.onChange({ position })}
					label={`${capitalized(logger.copy.participle)} through ${singular}`}
				/>
				{total === null ? null : <span className="text-text-muted">of {total}</span>}
			</div>
			{props.error === undefined ? (
				<p className="text-xs text-text-muted">
					{percent === undefined ? "" : `${percent}% of the ${logger.copy.noun} · `}earlier {plural}{" "}
					count as {logger.copy.participle}
				</p>
			) : (
				<FieldMessage>{props.error}</FieldMessage>
			)}
		</div>
	);
}

function StatusPicker(props: {
	readonly draft: ActivityDraft;
	readonly logger: MediaActivityLogger;
	readonly context: MediaActivityLogContext;
	readonly onChange: (patch: Partial<ActivityDraft>) => void;
}) {
	const note = activityStatusNote(props.logger, props.context);
	return (
		<div className="flex flex-col gap-2">
			<RadioGroup
				label="Status"
				value={props.draft.status}
				className="flex flex-col gap-2"
				onChange={(status) => props.onChange({ status })}
				options={activityStatusOptions(props.logger).map((option) => {
					const current = option.value === props.context.state;
					return Object.assign({}, option, {
						disabled: current,
						detail: current ? "Current status" : option.detail,
					});
				})}
				renderOption={(option, selected) => ({
					className: clsx(
						"flex w-full items-center gap-3 rounded-lg border px-3.5 py-3 text-left",
						selected ? "border-accent-border bg-accent-soft" : "border-border bg-surface",

						option.disabled && "opacity-60",
					),
					content: (
						<>
							<span
								aria-hidden="true"
								className={clsx(
									"size-4 shrink-0 rounded-full bg-surface",
									selected
										? "border-[5px] border-accent-deep"
										: "border-[1.5px] border-border-strong",
								)}
							/>
							<span className="flex min-w-0 flex-col">
								<span className="font-medium text-text">{option.label}</span>
								<span className="text-xs text-text-muted">{option.detail}</span>
							</span>
						</>
					),
				})}
			/>
			{note === undefined ? null : <p className="text-text-muted">{note}</p>}
		</div>
	);
}

type Body = {
	readonly today: string;
	readonly draft: ActivityDraft;
	readonly earlier: Earlier;
	readonly backfill: boolean;
	readonly locked: boolean;
	readonly suggestions: readonly string[];
	readonly logger: MediaActivityLogger;
	readonly pager: EpisodePager | undefined;
	readonly seasonNumber: number | undefined;
	readonly context: MediaActivityLogContext;
	readonly selected: ActivityEpisode | undefined;
	readonly onBackfill: (value: boolean) => void;
	readonly onSelect: (id: string) => void;
	readonly onSeason: (seasonNumber: number) => void;
	readonly onChange: (patch: Partial<ActivityDraft>) => void;
};

function EpisodeStep(props: Body) {
	const { pager, logger, context, earlier, selected } = props;
	const special = logger.family === "show" && selected?.seasonNumber === 0;
	const summary =
		earlier.status === "ready" && earlier.episodes.length > 0
			? backfillSummary(logger, earlier.episodes)
			: undefined;
	return (
		<div className="flex flex-col gap-3">
			{logger.family === "show" ? (
				<Field label="Season">
					{(control) => (
						<Select
							label="Season"
							id={control.id}
							value={String(props.seasonNumber ?? "")}
							checkIcon={<AppIcon size={16} name="check" />}
							onChange={(value) => props.onSeason(Number(value))}
							chevronIcon={<AppIcon size={16} name="chevron-down" />}
							choices={context.seasons.map((season) => ({
								value: String(season.seasonNumber),
								label: seasonLabel(season.seasonNumber),
							}))}
						/>
					)}
				</Field>
			) : null}
			{pager === undefined ? (
				<p className="text-text-muted">This show has no episodes to log yet.</p>
			) : (
				<EpisodeList
					pager={pager}
					logger={logger}
					onSelect={props.onSelect}
					selectedId={selected?.id}
					nextUpId={context.nextUp?.id}
				/>
			)}
			{selected?.state === "complete" ? (
				<p className="text-text-muted">
					You've already {logger.copy.participle} this one. It will be logged as a rewatch.
				</p>
			) : null}
			{earlier.status === "error" ? (
				<StatusMessage tone="error" action={{ label: "Try again", onClick: earlier.retry }}>
					Unable to check earlier episodes.
				</StatusMessage>
			) : null}
			{earlier.status === "loading" ? (
				<StatusMessage tone="pending">Checking earlier episodes…</StatusMessage>
			) : null}
			{earlier.status === "ready" && earlier.tooMany && !special ? (
				<Row
					title="Also mark earlier episodes"
					description={`More than ${BACKFILL_LIMIT} earlier episodes are unwatched, so none can be marked together. Mark them in smaller steps.`}
					trailing={
						<Switch
							disabled
							checked={false}
							onChange={() => undefined}
							label="Mark earlier episodes"
						/>
					}
				/>
			) : null}
			{summary === undefined || earlier.status !== "ready" || earlier.tooMany ? null : (
				<Row
					title={summary.label}
					description={summary.detail}
					trailing={
						<Switch
							label={summary.label}
							disabled={props.locked}
							checked={props.backfill}
							onChange={props.onBackfill}
						/>
					}
				/>
			)}
		</div>
	);
}

function ActivityLogFields(props: Body) {
	const { draft, today, logger, context } = props;
	const errors = activityDraftErrors({ draft, today, logger, context });
	const [details, setDetails] = useState(false);
	const finished = draft.intent === "finished";
	const timePrimary = logger.family === "flat" && logger.timePrimary === true;
	return (
		<>
			{draft.intent === "episode" ? <EpisodeStep {...props} /> : null}
			{draft.intent === "progress" && logger.family === "positional" ? (
				<PositionProgress
					draft={draft}
					logger={logger}
					context={context}
					error={errors.position}
					onChange={props.onChange}
				/>
			) : null}
			{draft.intent === "progress" && logger.family === "flat" ? (
				<FlatProgress
					draft={draft}
					logger={logger}
					context={context}
					error={errors.percent}
					onChange={props.onChange}
				/>
			) : null}
			{draft.intent === "status" ? (
				<StatusPicker draft={draft} logger={logger} context={context} onChange={props.onChange} />
			) : null}
			{finished || draft.intent === "episode" ? (
				<WhenField
					today={today}
					draft={draft}
					logger={logger}
					error={errors.when}
					onChange={props.onChange}
				/>
			) : null}
			{finished && timePrimary ? (
				<TimeSpentField
					draft={draft}
					error={errors.time}
					label="Time played"
					onChange={props.onChange}
					hint={activityRuntimeHint(null)}
				/>
			) : null}
			{draft.intent === "status" ? null : (
				<SourceField
					logger={logger}
					value={draft.consumedOn}
					error={errors.consumedOn}
					suggestions={props.suggestions}
					onChange={(consumedOn) => props.onChange({ consumedOn })}
				/>
			)}
			{finished && !timePrimary ? (
				<div className="flex flex-col gap-3">
					<Button
						variant="link"
						className="self-start"
						aria-expanded={details}
						onClick={() => setDetails(!details)}
					>
						{details ? "Hide details" : "More details"}
					</Button>
					{details ? (
						<TimeSpentField
							draft={draft}
							label="Time spent"
							error={errors.time}
							onChange={props.onChange}
							hint={activityRuntimeHint(context.runtime)}
						/>
					) : null}
				</div>
			) : null}
		</>
	);
}

function ActivityLogDialog(props: {
	readonly name: string;
	readonly compact: boolean;
	readonly entityId: string;
	readonly onClose: () => void;
	readonly onReview?: () => void;
	readonly logger: MediaActivityLogger;
	readonly context: MediaActivityLogContext;
	readonly initialEpisode?: ActivityEpisode;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const { logger, context, entityId, initialEpisode } = props;
	const schedule = useRyotSchedule();
	const today = localDay(schedule.now());
	const log = useRyotSubmission(logActivityMutation, {
		isComplete: (result) => result.status === "saved",
	});
	const [draft, setDraft] = useState(() => initialActivityDraft(logger, context, today));
	const [seasonNumber, setSeasonNumber] = useState(() =>
		logger.family === "show"
			? (initialEpisode?.seasonNumber ?? defaultSeasonNumber(context))
			: undefined,
	);
	const [episodeId, setEpisodeId] = useState(initialEpisode?.id);
	const [backfill, setBackfill] = useState(true);
	const [report, setReport] = useState<EarlierReport | undefined>(undefined);
	const [done, setDone] = useState<{ text: string; offerReview: boolean } | undefined>(undefined);
	const patch = (next: Partial<ActivityDraft>) => setDraft((current) => ({ ...current, ...next }));
	const locked = log.status !== "idle";
	const saved = log.data?.status === "saved";
	const settings = usePluginUserSettings(usePluginIdentity(PLUGIN_PACKAGE_ID).pluginId);
	const settingKey = consumedOnSettingKey(context.schemaSlug);
	const suggestions = consumedOnSuggestions(
		settingKey === undefined ? undefined : settings.data?.[settingKey],
		context.consumedOn,
	);

	const render = (pager: EpisodePager | undefined) => {
		const selected =
			pager === undefined
				? undefined
				: selectedEpisode({
						selectedId: episodeId,
						choices: pager.choices,
						nextUp: context.nextUp,
						initial: initialEpisode,
						seasonNumber: seasonNumber ?? null,
					});
		const special = logger.family === "show" && selected?.seasonNumber === 0;
		const checking =
			draft.intent === "episode" &&
			selected !== undefined &&
			!special &&
			(logger.family === "show" || logger.family === "podcast")
				? logger.family
				: undefined;
		let earlier: Earlier = { status: "none" };
		if (checking !== undefined && selected !== undefined) {
			earlier = report?.episodeId === selected.id ? report.earlier : { status: "loading" };
		}
		const earlierIds =
			backfill && earlier.status === "ready" && !earlier.tooMany
				? earlier.episodes.map((episode) => episode.id)
				: [];
		const episodeEntityIds = selected === undefined ? [] : [...earlierIds, selected.id];
		const errors = activityDraftErrors({ draft, today, logger, context });
		const waiting =
			draft.intent === "episode" &&
			(selected === undefined || earlier.status === "loading" || earlier.status === "error");
		const labels = activityCopyLabels({
			draft,
			logger,
			context,
			name: props.name,
			episodeCount: episodeEntityIds.length,
			episodeCode: selected === undefined ? undefined : episodeCode(logger, selected),
		});
		const submit = () => {
			if (waiting || hasActivityErrors(errors) || log.status !== "idle") {
				return;
			}
			setDone({ text: labels.success, offerReview: labels.offerReview });
			log.submit(activityEntryDraft({ draft, logger, context, entityId, episodeEntityIds }));
		};
		return (
			<Dialog
				title="Log activity"
				onClose={props.onClose}
				dismissible={!log.isPending}
				triggerRef={props.triggerRef}
				closeLabel="Close log activity"
				placement={props.compact ? "sheet" : "center"}
				footer={
					saved ? (
						<Button onClick={props.onClose}>Done</Button>
					) : (
						<>
							<Button variant="secondary" onClick={props.onClose} disabled={log.isPending}>
								Cancel
							</Button>
							{log.status === "retained" ? (
								<Button onClick={log.retry}>Retry</Button>
							) : (
								<Button
									onClick={submit}
									loading={log.isPending}
									disabled={waiting || hasActivityErrors(errors)}
								>
									{labels.submit}
								</Button>
							)}
						</>
					)
				}
			>
				{saved ? (
					<div className="flex flex-col items-start gap-3">
						<StatusMessage tone="success">{done?.text}</StatusMessage>
						{done?.offerReview === true && props.onReview !== undefined ? (
							<p className="text-text-muted">
								Want to say what you thought?{" "}
								<Button variant="link" onClick={props.onReview}>
									Write a review
								</Button>
							</p>
						) : null}
					</div>
				) : (
					<ActionForm onSubmit={submit} label="Log activity" className="flex flex-col gap-4">
						{activityIntents(logger).length < 2 ? null : (
							<SegmentedControl
								fill
								value={draft.intent}
								label="What happened"
								optionClassName="px-3"
								options={activityIntents(logger)}
								onChange={(intent) => patch({ intent })}
							/>
						)}
						<fieldset disabled={locked} className="flex min-w-0 flex-col gap-4">
							<ActivityLogFields
								draft={draft}
								today={today}
								pager={pager}
								locked={locked}
								logger={logger}
								onChange={patch}
								earlier={earlier}
								context={context}
								backfill={backfill}
								selected={selected}
								onSelect={setEpisodeId}
								onBackfill={setBackfill}
								suggestions={suggestions}
								seasonNumber={seasonNumber}
								onSeason={(next) => {
									setSeasonNumber(next);
									setEpisodeId(undefined);
								}}
							/>
						</fieldset>
						{checking === undefined || selected === undefined ? null : (
							<EarlierEpisodes
								kind={checking}
								entityId={entityId}
								onChange={setReport}
								episodeId={selected.id}
							/>
						)}
						{log.status === "retained" ? (
							<StatusMessage tone="error">
								This may already be saved. Retry the same submission to finish without duplicates.
								Cancel closes this form but does not undo anything already saved.
							</StatusMessage>
						) : null}
					</ActionForm>
				)}
			</Dialog>
		);
	};

	if (logger.family === "show" && seasonNumber !== undefined) {
		return (
			<ShowEpisodes entityId={entityId} seasonNumber={seasonNumber}>
				{render}
			</ShowEpisodes>
		);
	}
	if (logger.family === "podcast") {
		return <PodcastEpisodes entityId={entityId}>{render}</PodcastEpisodes>;
	}
	return render(undefined);
}

export function MediaActivityLogSheet(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly onClose: () => void;
	readonly onReview?: () => void;
	readonly logger: MediaActivityLogger;
	readonly initialEpisode?: ActivityEpisode;
	readonly triggerRef: RefObject<HTMLButtonElement | null>;
}) {
	const result = useRyotQuery(activityLogContextQuery, { entityId: props.entityId });
	if (result.data === undefined || result.data === null) {
		let message = "Loading…";
		if (result.data === null) {
			message = "This item can't be logged.";
		} else if (result.isError) {
			message = "Unable to load this item.";
		}
		return (
			<Dialog
				title="Log activity"
				onClose={props.onClose}
				triggerRef={props.triggerRef}
				closeLabel="Close log activity"
				placement={props.compact ? "sheet" : "center"}
			>
				<StatusMessage
					tone={result.isError ? "error" : "pending"}
					action={result.isError ? { label: "Try again", onClick: result.refetch } : undefined}
				>
					{message}
				</StatusMessage>
			</Dialog>
		);
	}
	return <ActivityLogDialog {...props} context={result.data} name={result.data.name} />;
}
