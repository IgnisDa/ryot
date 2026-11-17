import type { DisplayText, Text } from "@ryot-app/plugin-client-sdk/react";
import {
	localDay,
	paginationItems,
	useDisplayText,
	useFormatters,
	usePluginIdentity,
	usePluginUserSettings,
	useRyotInfiniteQuery,
	useRyotQuery,
	useRyotSchedule,
	useUserPreferences,
} from "@ryot-app/plugin-client-sdk/react";
import {
	ActionForm,
	Button,
	Chip,
	DateTimeField,
	Dialog,
	DurationField,
	Field,
	FieldMessage,
	RadioGroup,
	Row,
	SegmentedControl,
	StatusMessage,
	Stepper,
	Switch,
	TagInput,
	TextField,
} from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import { type RefObject, useEffect, useMemo, useState } from "react";

import type { MediaActivityLogContext } from "../../../shared/activity-log-recipes";
import {
	CONSUMED_ON_ITEM_LIMIT,
	CONSUMED_ON_SOURCES_LIMIT,
	consumedOnSettingKey,
} from "../../../shared/consumed-on-settings";
import { PLUGIN_PACKAGE_ID } from "../../../shared/plugin-identity";
import { type MediaText, useMediaMessages } from "../../messages";
import {
	ActivitySeasonSelector,
	EpisodeList,
	type EpisodePager,
	PodcastEpisodes,
	ShowEpisodes,
} from "../episode-picker";
import {
	activityLogContextQuery,
	type ActivityLogSubmission,
	earlierEpisodesQuery,
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
	type ActivityTimeDraft,
	activityUnitTotal,
	type ActivityWhenKind,
	addActivityTime,
	BACKFILL_LIMIT,
	backfillSummary,
	consumedOnSuggestions,
	convertedAmount,
	defaultSeasonNumber,
	draftProgressPercent,
	EARLIER_MAX_PAGES,
	episodeCode,
	episodeCodeMessage,
	episodeStateLabel,
	hasActivityErrors,
	initialActivityDraft,
	type MediaActivityLogger,
	nextActivityPosition,
	parsePositionNumber,
	positionLogUnit,
	removeActivityTime,
	resolveActivityDateTime,
	selectedEpisode,
} from "./state";

type Earlier =
	| { readonly status: "none" }
	| { readonly status: "loading" }
	| { readonly status: "error"; readonly retry: () => void }
	| {
			readonly status: "ready";
			readonly tooMany: boolean;
			readonly episodes: readonly ActivityEpisode[];
	  };

const FIRST_PAGE: null | string = null;

const whenOption = (value: ActivityWhenKind, label: Text) => ({ value, label, content: label });

const whenOptions = (text: MediaText, episode: boolean) => {
	return [
		whenOption("now", text("log.when.now")),
		whenOption("date", episode ? text("log.when.pick-date") : text("log.when.pick-dates")),
		whenOption("unknown", text("log.when.unknown")),
	];
};

type ActivityLogDialogProps = {
	readonly name: string;
	readonly compact: boolean;
	readonly entityId: string;
	readonly onClose: () => void;
	readonly onReview?: () => void;
	readonly log: ActivityLogSubmission;
	readonly logger: MediaActivityLogger;
	readonly context: MediaActivityLogContext;
	readonly initialEpisode?: ActivityEpisode;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
};

type Body = {
	readonly today: string;
	readonly locked: boolean;
	readonly earlier: Earlier;
	readonly backfill: boolean;
	readonly draft: ActivityDraft;
	readonly logger: MediaActivityLogger;
	readonly suggestions: readonly string[];
	readonly onSelect: (id: string) => void;
	readonly pager: undefined | EpisodePager;
	readonly seasonNumber: number | undefined;
	readonly context: MediaActivityLogContext;
	readonly onBackfill: (value: boolean) => void;
	readonly selected: undefined | ActivityEpisode;
	readonly onSeason: (seasonNumber: number) => void;
	readonly onChange: (patch: Partial<ActivityDraft>) => void;
};

export function MediaActivityLogSheet(props: {
	readonly compact: boolean;
	readonly entityId: string;
	readonly onClose: () => void;
	readonly onReview?: () => void;
	readonly log: ActivityLogSubmission;
	readonly logger: MediaActivityLogger;
	readonly initialEpisode?: ActivityEpisode;
	readonly triggerRef: RefObject<null | HTMLButtonElement>;
}) {
	const text = useMediaMessages();
	const result = useRyotQuery(activityLogContextQuery, { entityId: props.entityId });
	if (result.data === undefined || result.data === null) {
		let message = text("common.status.loading");
		if (result.data === null) {
			message = text("log.load.not-loggable");
		} else if (result.isError) {
			message = text("log.load.failed");
		}
		return (
			<Dialog
				onClose={props.onClose}
				title={text("log.title")}
				triggerRef={props.triggerRef}
				closeLabel={text("log.close")}
				placement={props.compact ? "sheet" : "center"}
			>
				<StatusMessage
					tone={result.isError ? "error" : "pending"}
					action={
						result.isError
							? { onClick: result.refetch, label: text("common.action.try-again") }
							: undefined
					}
				>
					{message}
				</StatusMessage>
			</Dialog>
		);
	}
	return <ActivityLogDialog {...props} context={result.data} name={result.data.name} />;
}

export function SourceField(props: {
	readonly value: readonly string[];
	readonly logger: MediaActivityLogger;
	readonly suggestions: readonly string[];
	readonly onChange: (value: readonly string[]) => void;
}) {
	const displayText = useDisplayText();
	const text = useMediaMessages();
	const selected = (suggestion: string) =>
		props.value.some((value) => value.toLowerCase() === suggestion.toLowerCase());
	const full = props.value.length >= CONSUMED_ON_SOURCES_LIMIT;
	const toggle = (suggestion: string) =>
		props.onChange(
			selected(suggestion)
				? props.value.filter((value) => value.toLowerCase() !== suggestion.toLowerCase())
				: [...props.value, suggestion],
		);
	return (
		<div className="flex flex-col gap-2">
			<Field optional label={text("log.source.label", { verb: props.logger.copy.verb })}>
				{(control) => (
					<TagInput
						{...control}
						values={props.value}
						onChange={props.onChange}
						maxLength={CONSUMED_ON_ITEM_LIMIT}
						maxItems={CONSUMED_ON_SOURCES_LIMIT}
						removeIcon={<AppIcon name="x" size={14} />}
						placeholder={text("log.source.placeholder")}
					/>
				)}
			</Field>
			{props.suggestions.length === 0 ? null : (
				<div className="flex flex-wrap gap-1.5">
					{props.suggestions.map((suggestion) => (
						<button
							type="button"
							key={suggestion}
							onClick={() => toggle(suggestion)}
							aria-pressed={selected(suggestion)}
							disabled={full && !selected(suggestion)}
						>
							<Chip checked={selected(suggestion)} label={displayText(suggestion)} />
						</button>
					))}
				</div>
			)}
		</div>
	);
}

export function PositionProgress(props: {
	readonly draft: ActivityDraft;
	readonly error: string | undefined;
	readonly context: MediaActivityLogContext;
	readonly onChange: (patch: Partial<ActivityDraft>) => void;
	readonly logger: Extract<MediaActivityLogger, { family: "positional" }>;
}) {
	const { draft, logger, context } = props;
	const text = useMediaMessages();
	const unit = positionLogUnit(logger, draft.positionUnit);
	const total = activityPositionTotal(context, unit);
	const label = text("log.position.label", { unit, verb: logger.copy.verb });
	const percent =
		total === null || draft.position === undefined ? undefined : draft.position / total;
	return (
		<div className="flex flex-col gap-2">
			<span className="text-[13px] font-medium text-text">{label}</span>
			{logger.units.length > 1 ? (
				<SegmentedControl
					value={unit}
					optionClassName="px-3"
					label={text("property.unit")}
					onChange={(positionUnit) =>
						props.onChange({ positionUnit, position: nextActivityPosition(context, positionUnit) })
					}
					options={logger.units.map((option) => {
						const optionLabel = text("log.unit.label", { unit: option });
						return { value: option, label: optionLabel, content: optionLabel };
					})}
				/>
			) : null}
			<div className="flex items-center gap-3">
				<Stepper
					min={1}
					step={1}
					label={label}
					className="w-44"
					value={draft.position}
					invalid={props.error !== undefined}
					incrementIcon={<AppIcon size={16} name="plus" />}
					decrementIcon={<AppIcon size={16} name="minus" />}
					parse={(input) => parsePositionNumber(unit, input)}
					onChange={(position) => props.onChange({ position })}
					inputMode={unit === "episodes" ? "numeric" : "decimal"}
				/>
				{total === null ? null : (
					<span className="text-text-muted">{text("log.position.of-total", { total })}</span>
				)}
			</div>
			{props.error === undefined ? (
				<p className="text-xs text-text-muted">
					{percent === undefined
						? text("log.position.hint", { unit, verb: logger.copy.verb })
						: text("log.position.hint-percent", { unit, percent, verb: logger.copy.verb })}
				</p>
			) : (
				<FieldMessage>{props.error}</FieldMessage>
			)}
		</div>
	);
}

export function FlatProgress(props: {
	readonly draft: ActivityDraft;
	readonly error: string | undefined;
	readonly logger: MediaActivityLogger;
	readonly context: MediaActivityLogContext;
	readonly onChange: (patch: Partial<ActivityDraft>) => void;
}) {
	const { draft, logger, context } = props;
	const text = useMediaMessages();
	const total = activityUnitTotal(logger, context);
	const unit = logger.family === "flat" ? logger.progressUnit : undefined;
	const exactPages = unit?.field === "pages" && draft.amountUnit === "unit";
	const canConvert =
		unit !== undefined &&
		total !== null &&
		(!exactPages || draftProgressPercent(draft, total) !== undefined);
	if (draft.progressMode === "started") {
		return (
			<div className="flex flex-col items-start gap-2">
				<p className="text-text-muted">{text("log.flat.started-note")}</p>
				<Button variant="link" onClick={() => props.onChange({ progressMode: "amount" })}>
					{text("log.flat.add-amount")}
				</Button>
			</div>
		);
	}
	let hint: string | undefined;
	if (unit !== undefined && total !== null) {
		if (exactPages) {
			const amount = draft.amount.trim() === "" ? Number.NaN : Number(draft.amount);
			hint =
				Number.isFinite(amount) && amount <= total
					? text("log.flat.hint-of", { total, field: unit.field })
					: text("log.flat.hint-provider-total", { total, field: unit.field });
		} else {
			hint =
				draft.amountUnit === "unit"
					? text("log.flat.hint-of", { total, field: unit.field })
					: text("log.flat.hint-total", { total, field: unit.field });
		}
	}
	return (
		<div className="flex flex-col items-start gap-2">
			<Field hint={hint} className="w-full" error={props.error} label={text("log.flat.label")}>
				{(control) => (
					<div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
						<TextField
							{...control}
							type="text"
							inputMode="decimal"
							value={draft.amount}
							onChange={(event) => props.onChange({ amount: event.currentTarget.value })}
						/>
						{unit === undefined || !canConvert ? (
							<span className="text-text-muted">
								{exactPages
									? text("log.flat.unit-plural", { field: unit.field })
									: text("common.percent-sign")}
							</span>
						) : (
							<SegmentedControl
								optionClassName="px-3"
								value={draft.amountUnit}
								label={text("property.unit")}
								onChange={(amountUnit) =>
									props.onChange({ amountUnit, amount: convertedAmount(draft, amountUnit, total) })
								}
								options={[
									{
										value: "percent",
										label: text("log.flat.percent"),
										content: text("common.percent-sign"),
									},
									{
										value: "unit",
										label: text("log.flat.unit-label", { field: unit.field }),
										content: text("log.flat.unit-plural", { field: unit.field }),
									},
								]}
							/>
						)}
					</div>
				)}
			</Field>
			<Button variant="link" onClick={() => props.onChange({ progressMode: "started" })}>
				{text("log.flat.skip-amount")}
			</Button>
		</div>
	);
}

export function WhenField(props: {
	readonly today: string;
	readonly draft: ActivityDraft;
	readonly logger: MediaActivityLogger;
	readonly error: undefined | DisplayText;
	readonly kinds?: readonly ActivityWhenKind[];
	readonly onChange: (patch: Partial<ActivityDraft>) => void;
}) {
	const { draft, logger } = props;
	const displayText = useDisplayText();
	const text = useMediaMessages();
	const schedule = useRyotSchedule();
	const timeZone = useUserPreferences().data?.timeZone;
	const episode = draft.intent === "episode";
	const { time } = draft;
	let whenLabel = text("log.when.finish");
	if (episode) {
		whenLabel = text("log.when.episode", { verb: logger.copy.verb });
	}
	if (draft.intent === "progress") {
		whenLabel = text("log.when.progress");
	}
	const finishedLabel = episode
		? text("log.when.episode-on", { verb: logger.copy.verb })
		: text("log.when.finished");
	const icons = {
		checkIcon: <AppIcon size={16} name="check" />,
		chevronIcon: <AppIcon size={16} name="chevron-down" />,
	};
	const dateTimeField = (
		key: "started" | "finished",
		label: Text,
		current: ActivityTimeDraft,
		optional: boolean,
	) => (
		<DateTimeField
			{...icons}
			label={label}
			showError={false}
			optional={optional}
			value={current[key].value}
			resolution={resolveActivityDateTime(current[key], current.timeZone)}
			onOccurrenceChange={(occurrence) =>
				props.onChange({ time: { ...current, [key]: { ...current[key], occurrence } } })
			}
			onChange={(value) =>
				props.onChange({
					time: { ...current, [key]: { ...current[key], value, occurrence: undefined } },
				})
			}
		/>
	);
	return (
		<div className="flex flex-col gap-2">
			<span className="text-[13px] font-medium text-text">{whenLabel}</span>
			<SegmentedControl
				fill
				value={draft.when}
				optionClassName="px-3"
				label={text("log.when.label")}
				onChange={(when) => props.onChange({ when })}
				options={whenOptions(text, episode).filter(
					(option) => props.kinds === undefined || props.kinds.includes(option.value),
				)}
			/>
			{draft.when === "date" && time !== null ? (
				<div className="grid gap-3">
					{episode ? null : dateTimeField("started", text("log.when.started"), time, true)}
					{dateTimeField("finished", finishedLabel, time, false)}
				</div>
			) : null}
			{draft.when === "date" && time === null ? (
				<div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
					{episode ? null : (
						<Field optional label={text("log.when.started")}>
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
					<Field label={finishedLabel}>
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
			{draft.when === "date" && (time !== null || timeZone !== undefined) ? (
				<Button
					variant="link"
					className="self-start"
					onClick={() =>
						props.onChange(
							time !== null || timeZone === undefined
								? removeActivityTime(draft)
								: addActivityTime(draft, schedule.now(), timeZone),
						)
					}
				>
					{time === null ? text("log.when.add-time") : text("log.when.remove-time")}
				</Button>
			) : null}
			{props.error === undefined ? null : <FieldMessage>{displayText(props.error)}</FieldMessage>}
			{draft.when === "unknown" ? (
				<p className="text-text-muted">{text("log.when.unknown-note")}</p>
			) : null}
		</div>
	);
}

function ActivityLogDialog(props: ActivityLogDialogProps) {
	const { logger, context, entityId, initialEpisode } = props;
	const [seasonNumber, setSeasonNumber] = useState(() =>
		logger.family === "show"
			? (initialEpisode?.seasonNumber ?? defaultSeasonNumber(context))
			: undefined,
	);
	const [episodeId, setEpisodeId] = useState(initialEpisode?.id);
	const render = (pager: undefined | EpisodePager) => (
		<ActivityLogForm
			{...props}
			pager={pager}
			episodeId={episodeId}
			onSelect={setEpisodeId}
			seasonNumber={seasonNumber}
			onSeason={(next) => {
				setSeasonNumber(next);
				setEpisodeId(undefined);
			}}
		/>
	);

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

function useEarlierEpisodes(props: {
	readonly entityId: string;
	readonly episodeId: string | undefined;
	readonly kind: "show" | "podcast" | undefined;
}): Earlier {
	const { kind, entityId, episodeId } = props;
	const enabled = kind !== undefined && episodeId !== undefined;
	const query = useRyotInfiniteQuery(
		earlierEpisodesQuery,
		{ kind: kind ?? "show", parentEntityId: entityId, episodeEntityId: episodeId ?? "" },
		{
			enabled,
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
	return enabled ? earlier : { status: "none" };
}

function StatusPicker(props: {
	readonly draft: ActivityDraft;
	readonly logger: MediaActivityLogger;
	readonly context: MediaActivityLogContext;
	readonly onChange: (patch: Partial<ActivityDraft>) => void;
}) {
	const text = useMediaMessages();
	const note = activityStatusNote(text, props.logger, props.context);
	return (
		<div className="flex flex-col gap-2">
			<RadioGroup
				value={props.draft.status}
				className="flex flex-col gap-2"
				label={text("property.status")}
				onChange={(status) => props.onChange({ status })}
				options={activityStatusOptions(text, props.logger).map((option) => {
					const current = option.value === props.context.state;
					return Object.assign({}, option, {
						disabled: current,
						detail: current ? text("log.status.current") : option.detail,
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

function EpisodeStep(props: Body) {
	const { pager, logger, context, earlier, selected } = props;
	const text = useMediaMessages();
	const formatters = useFormatters();
	const special = logger.family === "show" && selected?.seasonNumber === 0;
	const summary =
		earlier.status === "ready" && earlier.episodes.length > 0
			? backfillSummary(text, formatters, logger, earlier.episodes)
			: undefined;
	return (
		<div className="flex flex-col gap-3">
			{logger.family === "show" ? (
				<ActivitySeasonSelector
					entityId={context.id}
					seasonNumber={props.seasonNumber}
					onSeason={(season) => props.onSeason(season.seasonNumber)}
				/>
			) : null}
			{pager === undefined ? (
				<p className="text-text-muted">{text("log.episodes.none-show")}</p>
			) : (
				<EpisodeList
					pager={pager}
					onSelect={props.onSelect}
					selectedId={selected?.id}
					emptyMessage={text("log.episodes.none")}
					family={logger.family === "podcast" ? "podcast" : "show"}
					stateLabel={(episode) =>
						episodeStateLabel({ text, logger, episode, nextUpId: context.nextUp?.id })
					}
				/>
			)}
			{selected?.state === "complete" ? (
				<p className="text-text-muted">
					{text("log.episodes.rewatch", { verb: logger.copy.verb })}
				</p>
			) : null}
			{earlier.status === "error" ? (
				<StatusMessage
					tone="error"
					action={{ onClick: earlier.retry, label: text("common.action.try-again") }}
				>
					{text("log.episodes.earlier-failed")}
				</StatusMessage>
			) : null}
			{earlier.status === "loading" ? (
				<StatusMessage tone="pending">{text("log.episodes.earlier-loading")}</StatusMessage>
			) : null}
			{earlier.status === "ready" && earlier.tooMany && !special ? (
				<Row
					title={text("log.backfill.title")}
					description={text("log.backfill.too-many", {
						count: BACKFILL_LIMIT,
						verb: logger.copy.verb,
					})}
					trailing={
						<Switch
							disabled
							checked={false}
							onChange={() => undefined}
							label={text("log.backfill.switch")}
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
	const text = useMediaMessages();
	const formatters = useFormatters();
	const errors = activityDraftErrors({ text, draft, today, logger, context });
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
			{finished || draft.intent === "episode" || draft.intent === "progress" ? (
				<WhenField
					today={today}
					draft={draft}
					logger={logger}
					error={errors.when}
					onChange={props.onChange}
				/>
			) : null}
			{finished && timePrimary ? (
				<DurationField
					value={draft}
					error={errors.time}
					onChange={props.onChange}
					label={text("log.time-played")}
					hint={activityRuntimeHint(text, formatters, null)}
				/>
			) : null}
			{draft.intent === "progress" ? (
				<DurationField
					value={draft}
					error={errors.time}
					onChange={props.onChange}
					label={text("log.time-cumulative")}
					hint={text("log.time-cumulative-hint")}
				/>
			) : null}
			{draft.intent === "status" ? null : (
				<SourceField
					logger={logger}
					value={draft.consumedOn}
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
						{details ? text("log.details-hide") : text("log.details-show")}
					</Button>
					{details ? (
						<DurationField
							value={draft}
							error={errors.time}
							onChange={props.onChange}
							label={text("property.time-spent")}
							hint={activityRuntimeHint(text, formatters, context.runtime)}
						/>
					) : null}
				</div>
			) : null}
		</>
	);
}

function ActivityLogForm(
	props: ActivityLogDialogProps & {
		readonly episodeId: string | undefined;
		readonly pager: undefined | EpisodePager;
		readonly seasonNumber: number | undefined;
		readonly onSelect: (episodeId: string) => void;
		readonly onSeason: (seasonNumber: number) => void;
	},
) {
	const { logger, context, entityId, initialEpisode } = props;
	const { pager, episodeId, seasonNumber } = props;
	const schedule = useRyotSchedule();
	const today = localDay(schedule.now());
	const { log } = props;
	const text = useMediaMessages();
	const [draft, setDraft] = useState(() => initialActivityDraft(logger, context, today));
	const [backfill, setBackfill] = useState(true);
	const patch = (next: Partial<ActivityDraft>) => setDraft((current) => ({ ...current, ...next }));
	const locked = log.isSending;
	const settings = usePluginUserSettings(usePluginIdentity(PLUGIN_PACKAGE_ID).pluginId);
	const settingKey = consumedOnSettingKey(context.schemaSlug);
	const suggestions = consumedOnSuggestions(
		settingKey === undefined ? undefined : settings.data?.[settingKey],
		context.consumedOn,
	);

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
	const earlier = useEarlierEpisodes({ entityId, kind: checking, episodeId: selected?.id });
	const earlierIds =
		backfill && earlier.status === "ready" && !earlier.tooMany
			? earlier.episodes.map((episode) => episode.id)
			: [];
	const episodeEntityIds = selected === undefined ? [] : [...earlierIds, selected.id];
	const errors = activityDraftErrors({ text, draft, today, logger, context });
	const waiting =
		draft.intent === "episode" &&
		(selected === undefined || earlier.status === "loading" || earlier.status === "error");
	const labels = activityCopyLabels({
		text,
		draft,
		logger,
		context,
		name: props.name,
		episodeCount: episodeEntityIds.length,
		episodeCode:
			selected === undefined
				? undefined
				: {
						text: episodeCode(text, logger, selected),
						message: episodeCodeMessage(logger, selected),
					},
	});
	const submit = () => {
		if (waiting || hasActivityErrors(errors) || log.isSending) {
			return;
		}
		const onReview = labels.offerReview ? props.onReview : undefined;
		log.submit(
			{
				label: labels.success,
				entry: activityEntryDraft({ draft, logger, context, entityId, episodeEntityIds }),
			},
			{ onAccepted: onReview ?? props.onClose },
		);
	};
	return (
		<Dialog
			onClose={props.onClose}
			title={text("log.title")}
			dismissible={!log.isSending}
			triggerRef={props.triggerRef}
			closeLabel={text("log.close")}
			placement={props.compact ? "sheet" : "center"}
			footer={
				<>
					<Button variant="secondary" onClick={props.onClose} disabled={log.isSending}>
						{text("common.action.cancel")}
					</Button>
					<Button
						onClick={submit}
						loading={log.isSending}
						disabled={waiting || hasActivityErrors(errors)}
					>
						{labels.submit}
					</Button>
				</>
			}
		>
			<ActionForm onSubmit={submit} label={text("log.title")} className="flex flex-col gap-4">
				{activityIntents(text, logger).length < 2 ? null : (
					<SegmentedControl
						fill
						value={draft.intent}
						optionClassName="px-3"
						label={text("log.intent-label")}
						options={activityIntents(text, logger)}
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
						onBackfill={setBackfill}
						onSelect={props.onSelect}
						suggestions={suggestions}
						onSeason={props.onSeason}
						seasonNumber={seasonNumber}
					/>
				</fieldset>
				{log.error === null ? null : (
					<StatusMessage tone="error">{text("log.save-failed")}</StatusMessage>
				)}
			</ActionForm>
		</Dialog>
	);
}
