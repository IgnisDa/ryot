import { PluginLink, type TimeZone, useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { paginationItems, useRyotInfiniteQuery } from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	Dialog,
	EmptyState,
	LoadMoreButton,
	MotionPresence,
	StatusMessage,
} from "@ryot-app/plugin-ui-sdk";
import { useMemo } from "react";

import {
	type AnalyticsInput,
	formatExactValue,
	type MediaAnalyticsRecord,
	type MediaConsumptionReport,
	recordModel,
	type RecordsDrillRequest,
	type Reported,
} from "./model";
import { analyticsPageInput, mediaAnalyticsRecordsQuery, nextAnalyticsPage } from "./queries";

export function MediaAnalyticsRecords(props: {
	readonly onClose: () => void;
	readonly input: AnalyticsInput;
	readonly request: RecordsDrillRequest;
	readonly report: Reported<MediaConsumptionReport>;
}) {
	const viewport = useRyotViewport();
	const result = useRyotInfiniteQuery(
		mediaAnalyticsRecordsQuery,
		{
			timeZone: props.input.timeZone,
			reference: props.input.reference,
			selection: props.request.selection,
			processing: props.report.processing,
			...(props.request.entityId === undefined ? {} : { entityId: props.request.entityId }),
			...(props.request.mediaType === undefined ? {} : { mediaType: props.request.mediaType }),
			...(props.request.hour === undefined ? {} : { hour: props.request.hour }),
			...(props.request.activeOnly === undefined ? {} : { activeOnly: props.request.activeOnly }),
		},
		{
			initialPageParam: null,
			getPageInput: analyticsPageInput,
			getNextPageParam: nextAnalyticsPage,
		},
	);
	const items = useMemo(
		() =>
			paginationItems(
				result.pages,
				(page) => page.items,
				({ id }) => id,
			),
		[result.pages],
	);
	const loadedCaption =
		result.pages.length === 0
			? null
			: `${items.length}${result.hasNextPage ? "+" : ""} ${items.length === 1 ? "record" : "records"}`;
	let errorMessage = "The records couldn't be loaded.";
	if (result.errorOperation === "append") {
		errorMessage = "More records couldn't be loaded.";
	} else if (result.errorOperation === "refresh") {
		errorMessage = "The records couldn't be refreshed.";
	}
	const heading = `${props.request.title} · ${props.request.periodCaption}`;
	const filters = [
		...(props.request.mediaType === undefined ? [] : [`Type: ${props.request.mediaType}`]),
		...(props.request.hour === undefined ? [] : [`Hour: ${props.request.hour}`]),
		...(props.request.activeOnly === true ? ["Active observations only"] : []),
	];
	return (
		<MotionPresence>
			<Dialog
				size="lg"
				title={heading}
				onClose={props.onClose}
				key="media-analytics-records"
				safeAreaBottom={viewport.safeAreaBottom}
				closeLabel="Close media analytics records"
				placement={viewport.compact ? "sheet" : "center"}
				footer={
					<Button variant="secondary" onClick={props.onClose}>
						Close
					</Button>
				}
			>
				<section
					className="flex min-w-0 flex-col gap-3"
					aria-label={`Records for ${props.request.title}`}
				>
					<p className="text-label text-text-muted">
						Period: {props.request.periodCaption} · Time zone: {props.input.timeZone}
						{filters.length === 0 ? "" : ` · ${filters.join(" · ")}`}
					</p>
					<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
						{loadedCaption === null ? null : (
							<span className="text-label text-text-muted tabular-nums">
								{loadedCaption} loaded
							</span>
						)}
						<Button
							size="sm"
							variant="secondary"
							onClick={result.refetch}
							disabled={result.isFetching}
						>
							Refresh records
						</Button>
					</div>
					{result.pages.length === 0 && result.isError ? (
						<StatusMessage
							tone="error"
							action={{ label: "Try again", onClick: result.retry, disabled: result.isFetching }}
						>
							{errorMessage}
						</StatusMessage>
					) : null}
					{result.pages.length === 0 && !result.isError ? (
						<StatusMessage tone="pending">Loading records…</StatusMessage>
					) : null}
					{result.pages.length > 0 ? (
						<>
							{result.operation === "refresh" ? (
								<StatusMessage tone="pending">Refreshing records…</StatusMessage>
							) : null}
							{result.isError ? (
								<StatusMessage
									tone="error"
									action={{
										label: "Try again",
										onClick: result.retry,
										disabled: result.isFetching,
									}}
								>
									{errorMessage}
								</StatusMessage>
							) : null}
							{items.length === 0 ? (
								<EmptyState title="No records in this period" />
							) : (
								<RecordTable
									items={items}
									timeZone={props.input.timeZone}
									processing={props.report.processing}
								/>
							)}
							{result.hasNextPage && !result.isError ? (
								<LoadMoreButton
									variant="secondary"
									className="self-center"
									label="Show more records"
									disabled={result.isFetching}
									onClick={result.fetchNextPage}
									isFetchingNextPage={result.isFetchingNextPage}
								/>
							) : null}
						</>
					) : null}
				</section>
			</Dialog>
		</MotionPresence>
	);
}

function RecordDate(props: { readonly timeZone: TimeZone; readonly row: MediaAnalyticsRecord }) {
	const attribution = props.row.contribution.attribution;
	const modeled = recordModel(props.row, "ready");
	if (attribution.kind === "unknown") {
		return <span>{modeled.date}</span>;
	}
	if (attribution.kind === "date") {
		return <time dateTime={attribution.value}>{modeled.date}</time>;
	}
	return (
		<time dateTime={attribution.value}>
			{new Intl.DateTimeFormat("en-US", {
				timeStyle: "short",
				dateStyle: "medium",
				timeZone: props.timeZone,
			}).format(new Date(attribution.value))}
		</time>
	);
}

function Contribution(props: {
	readonly processing: MediaConsumptionReport["processing"];
	readonly contribution: ReturnType<typeof recordModel>["contribution"];
}) {
	if (props.contribution === null) {
		return <span>Unavailable while consumption processing is {props.processing}.</span>;
	}
	const contribution = props.contribution;
	const measures = [
		["Pages", contribution.pages],
		["Minutes", contribution.minutes],
		["Volumes", contribution.volumes],
		["Episodes", contribution.episodes],
		["Chapters", contribution.chapters],
	] as const;
	return (
		<dl className="flex flex-col gap-1">
			<div>
				<dt className="inline font-medium text-text">Active observation: </dt>
				<dd className="inline">{contribution.activeObservation ? "Yes" : "No"}</dd>
			</div>
			<div>
				<dt className="inline font-medium text-text">Title completions: </dt>
				<dd className="inline">{formatExactValue(contribution.titleCompletions)}</dd>
			</div>
			<div>
				<dt className="inline font-medium text-text">Episode completions: </dt>
				<dd className="inline">{formatExactValue(contribution.episodeCompletions)}</dd>
			</div>
			{measures.map(([label, measure]) =>
				measure === undefined ? null : (
					<div key={label}>
						<dt className="inline font-medium text-text">{label}: </dt>
						<dd className="inline">
							{formatExactValue(measure.recorded, "recorded")} ·{" "}
							{formatExactValue(measure.estimated, "estimated")} · missing:{" "}
							{measure.missing ? "yes" : "no"} · superseded estimate:{" "}
							{measure.supersededEstimate ? "yes" : "no"}
						</dd>
					</div>
				),
			)}
		</dl>
	);
}

function RecordTable(props: {
	readonly timeZone: TimeZone;
	readonly items: readonly MediaAnalyticsRecord[];
	readonly processing: MediaConsumptionReport["processing"];
}) {
	return (
		<Card padding="none" className="overflow-x-auto">
			<table className="w-full min-w-240 border-collapse text-sm tabular-nums">
				<caption className="sr-only">Media analytics records</caption>
				<thead>
					<tr>
						<th scope="col" className="px-3 py-2.5 text-left font-medium text-text-muted">
							Name
						</th>
						<th scope="col" className="px-3 py-2.5 text-left font-medium text-text-muted">
							Category
						</th>
						<th scope="col" className="px-3 py-2.5 text-left font-medium text-text-muted">
							Source event type
						</th>
						<th scope="col" className="px-3 py-2.5 text-left font-medium text-text-muted">
							Reading date
						</th>
						<th scope="col" className="px-3 py-2.5 text-left font-medium text-text-muted">
							Source facts
						</th>
						<th scope="col" className="px-3 py-2.5 text-left font-medium text-text-muted">
							Canonical contribution
						</th>
					</tr>
				</thead>
				<tbody>
					{props.items.map((row) => {
						const modeled = recordModel(row, props.processing);
						return (
							<tr key={row.id} className="border-t border-border align-top">
								<td className="px-3 py-2.5">
									<PluginLink
										className="font-medium text-accent-text"
										to={{ kind: "entity", entityId: row.entityId }}
									>
										{row.name}
									</PluginLink>
								</td>
								<td className="px-3 py-2.5 text-text-muted">{modeled.category}</td>
								<td className="px-3 py-2.5 text-text-muted">{row.eventType}</td>
								<td className="whitespace-nowrap px-3 py-2.5 text-text-muted">
									<RecordDate row={row} timeZone={props.timeZone} />
								</td>
								<td className="min-w-55 px-3 py-2.5 text-text-muted">
									<SourceFacts row={row} modeled={modeled} />
								</td>
								<td className="min-w-64 px-3 py-2.5 text-text-muted">
									<Contribution processing={props.processing} contribution={modeled.contribution} />
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</Card>
	);
}

function SourceFacts(props: {
	readonly row: MediaAnalyticsRecord;
	readonly modeled: ReturnType<typeof recordModel>;
}) {
	const { facts } = props.row;
	const lines = [
		...(props.modeled.item === null
			? []
			: [{ value: props.modeled.item, label: "Consumed item position" }]),
		...(props.modeled.manualMinutes === null
			? []
			: [
					{
						label: "Manually recorded time",
						value: formatExactValue(props.modeled.manualMinutes, "minutes"),
					},
				]),
		...(props.modeled.sourceProgress === null
			? []
			: [{ label: "Source progress", value: props.modeled.sourceProgress }]),
		...(facts.progressPages === undefined
			? []
			: [
					{ label: "Source progress pages", value: formatExactValue(facts.progressPages, "pages") },
				]),
		...(facts.progressPercent === undefined
			? []
			: [
					{ label: "Source progress percent", value: formatExactValue(facts.progressPercent, "%") },
				]),
		...(facts.consumptionBasis === undefined
			? []
			: [
					{
						label: "Frozen consumption basis",
						value: [
							facts.consumptionBasis.unit,
							...(facts.consumptionBasis.total === undefined
								? []
								: [`total ${formatExactValue(facts.consumptionBasis.total)}`]),
							...(facts.consumptionBasis.property === undefined
								? []
								: [`source property ${facts.consumptionBasis.property}`]),
						].join(" · "),
					},
				]),
		...(facts.calendarDate === undefined
			? []
			: [{ value: facts.calendarDate, label: "Source calendar date" }]),
		...(facts.consumedOn === undefined
			? []
			: [{ value: facts.consumedOn, label: "Original consumed-on value" }]),
		...(facts.dateUnknown === true ? [{ label: "Source date", value: "Marked unknown" }] : []),
		...(facts.animeEpisode === undefined
			? []
			: [{ label: "Source anime episode", value: formatExactValue(facts.animeEpisode) }]),
		...(facts.mangaChapter === undefined
			? []
			: [{ label: "Source manga chapter", value: formatExactValue(facts.mangaChapter) }]),
		...(facts.mangaVolume === undefined
			? []
			: [{ label: "Source manga volume", value: formatExactValue(facts.mangaVolume) }]),
		...(facts.completionKey === undefined
			? []
			: [{ value: facts.completionKey, label: "Source completion key" }]),
	];
	return lines.length === 0 ? (
		<span>None recorded</span>
	) : (
		<dl className="flex flex-col gap-1">
			{lines.map(({ label, value }) => (
				<div key={label}>
					<dt className="inline font-medium text-text">{label}: </dt>
					<dd className="inline">{value}</dd>
				</div>
			))}
		</dl>
	);
}
