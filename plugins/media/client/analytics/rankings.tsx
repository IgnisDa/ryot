import {
	formatExactValue,
	periodCaption,
	PluginLink,
	useRyotViewport,
} from "@ryot-app/plugin-client-sdk/plugin";
import {
	paginationItems,
	reportingPageParam,
	useRyotInfiniteQuery,
} from "@ryot-app/plugin-client-sdk/react";
import {
	Button,
	Card,
	EmptyState,
	LoadMoreButton,
	Select,
	StatusMessage,
} from "@ryot-app/plugin-ui-sdk";
import { RankedBarList } from "@ryot-app/plugin-ui-sdk/charts";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import { useMemo, useState } from "react";

import {
	type MediaAnalyticsRanking,
	mediaTypeLabel,
	rankingModel,
	type RankingsRecordsProps,
	type RecordsDrillRequest,
} from "./model";
import { analyticsPageInput, mediaAnalyticsRankingQuery } from "./queries";

export function MediaAnalyticsRankings(props: RankingsRecordsProps) {
	const viewport = useRyotViewport();
	const [mediaType, setMediaType] = useState<string>();
	const mediaTypes = props.report.current.items.map(({ mediaType: slug }) => slug);
	const choices = [
		{ value: "", label: "All media types" },
		...mediaTypes.map((slug) => ({ value: slug, label: mediaTypeLabel(slug) })),
	];
	return (
		<section
			aria-label="Media rankings"
			className={`flex min-w-0 flex-col font-ui ${viewport.compact ? "gap-3" : "gap-4"}`}
		>
			<header className="flex min-w-0 flex-wrap items-baseline justify-between gap-3">
				<div>
					<h2 className="text-heading font-semibold text-text">Rankings</h2>
					<p className="text-label text-text-muted">
						Ranked by active observations in the selected period.
					</p>
				</div>
				<Select
					choices={choices}
					value={mediaType ?? ""}
					label="Ranking media type"
					className="w-full max-w-xs"
					checkIcon={<AppIcon size={14} name="check" />}
					chevronIcon={<AppIcon size={14} name="chevron-down" />}
					onChange={(value) => setMediaType(value === "" ? undefined : value)}
				/>
			</header>
			<RankingResults
				input={props.input}
				mediaType={mediaType}
				report={props.report}
				onDrill={props.onDrill}
			/>
		</section>
	);
}

function RankingTable(props: {
	readonly items: ReturnType<typeof rankingModel>;
	readonly onDrill: (request: RecordsDrillRequest) => void;
	readonly request: (
		row: Pick<MediaAnalyticsRanking["items"][number], "name" | "entityId" | "mediaType">,
	) => null | RecordsDrillRequest;
}) {
	return (
		<Card padding="none" className="overflow-x-auto">
			<table className="w-full min-w-190 border-collapse text-sm tabular-nums">
				<caption className="sr-only">Media entity rankings</caption>
				<thead>
					<tr>
						<th scope="col" className="px-3 py-2.5 text-left font-medium text-text-muted">
							Name
						</th>
						<th scope="col" className="px-3 py-2.5 text-left font-medium text-text-muted">
							Category
						</th>
						<th scope="col" className="px-3 py-2.5 text-right font-medium text-text-muted">
							Active observations
						</th>
						<th scope="col" className="px-3 py-2.5 text-right font-medium text-text-muted">
							Title completions
						</th>
						<th scope="col" className="px-3 py-2.5 text-right font-medium text-text-muted">
							Episode completions
						</th>
						<th scope="col" className="px-3 py-2.5 text-right font-medium text-text-muted">
							<span className="sr-only">Actions</span>
						</th>
					</tr>
				</thead>
				<tbody>
					{props.items.map((row) => {
						const drill = props.request(row);
						return (
							<tr key={row.entityId} className="border-t border-border">
								<td className="px-3 py-2.5">
									<PluginLink
										className="font-medium text-accent-text"
										to={{ kind: "entity", entityId: row.entityId }}
									>
										{row.name}
									</PluginLink>
								</td>
								<td className="px-3 py-2.5 text-text-muted">{row.category}</td>
								<td className="px-3 py-2.5 text-right text-text-muted">
									{formatExactValue(row.activeObservations, "observations")}
								</td>
								<td className="px-3 py-2.5 text-right text-text-muted">
									{formatExactValue(row.titleCompletions, "titles")}
								</td>
								<td className="px-3 py-2.5 text-right text-text-muted">
									{formatExactValue(row.episodeCompletions, "episodes")}
								</td>
								<td className="px-3 py-2.5 text-right">
									<Button
										size="sm"
										variant="link"
										disabled={drill === null}
										aria-label={`View records contributing to ${row.name}`}
										onClick={() => {
											if (drill !== null) {
												props.onDrill(drill);
											}
										}}
									>
										View records
									</Button>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</Card>
	);
}

function RankingResults(props: {
	readonly mediaType: string | undefined;
	readonly input: RankingsRecordsProps["input"];
	readonly report: RankingsRecordsProps["report"];
	readonly onDrill: RankingsRecordsProps["onDrill"];
}) {
	const result = useRyotInfiniteQuery(
		mediaAnalyticsRankingQuery,
		{
			...props.input,
			processing: props.report.processing,
			...(props.mediaType === undefined ? {} : { mediaType: props.mediaType }),
		},
		{
			initialPageParam: null,
			getPageInput: analyticsPageInput,
			getNextPageParam: reportingPageParam,
		},
	);
	const rows = useMemo(
		() =>
			paginationItems(
				result.pages,
				(page) => page.items,
				({ entityId }) => entityId,
			),
		[result.pages],
	);
	const modeledRows = useMemo(
		() => rankingModel(rows, props.report.processing),
		[props.report.processing, rows],
	);
	const firstPage = result.pages[0];
	const preview = useMemo(
		() =>
			modeledRows
				.slice(0, 10)
				.flatMap((row) =>
					row.activeObservations === null
						? []
						: [{ label: row.name, key: row.entityId, value: row.activeObservations }],
				),
		[modeledRows],
	);
	const loadedCaption =
		firstPage === undefined
			? null
			: `${rows.length}${result.hasNextPage ? "+" : ""} ${rows.length === 1 ? "entity" : "entities"}`;
	let errorMessage = "The rankings couldn't be loaded.";
	if (result.errorOperation === "append") {
		errorMessage = "More rankings couldn't be loaded.";
	} else if (result.errorOperation === "refresh") {
		errorMessage = "The rankings couldn't be refreshed.";
	}
	const requestFor = (
		row: Pick<MediaAnalyticsRanking["items"][number], "name" | "entityId" | "mediaType">,
	): null | RecordsDrillRequest => {
		if (firstPage === undefined) {
			return null;
		}
		return {
			title: row.name,
			activeOnly: true,
			entityId: row.entityId,
			mediaType: row.mediaType,
			selection: firstPage.reporting.selection,
			periodCaption: periodCaption(firstPage.reporting.resolved.current),
		};
	};
	const allRecordsRequest: null | RecordsDrillRequest =
		firstPage === undefined
			? null
			: {
					...(props.mediaType === undefined ? {} : { mediaType: props.mediaType }),
					activeOnly: false,
					title: "All records",
					selection: firstPage.reporting.selection,
					periodCaption: periodCaption(firstPage.reporting.resolved.current),
				};
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-2">
				<h3 className="text-body font-semibold text-text">Ranked entities</h3>
				<div className="flex items-center gap-3">
					{loadedCaption === null ? null : (
						<span className="text-label text-text-muted tabular-nums">{loadedCaption} loaded</span>
					)}
					<Button
						size="sm"
						variant="secondary"
						onClick={result.refetch}
						disabled={result.isFetching}
					>
						Refresh
					</Button>
				</div>
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
				<StatusMessage tone="pending">Loading rankings…</StatusMessage>
			) : null}
			{result.pages.length > 0 ? (
				<>
					{result.operation === "refresh" ? (
						<StatusMessage tone="pending">Refreshing rankings…</StatusMessage>
					) : null}
					{result.isError ? (
						<StatusMessage
							tone="error"
							action={{ label: "Try again", onClick: result.retry, disabled: result.isFetching }}
						>
							{errorMessage}
						</StatusMessage>
					) : null}
					{props.report.processing === "ready" ? null : (
						<StatusMessage tone={props.report.processing === "failed" ? "error" : "pending"}>
							Ranking counts are unavailable while consumption processing is{" "}
							{props.report.processing}.
						</StatusMessage>
					)}
					{rows.length === 0 ? (
						<EmptyState title="No ranked entities" />
					) : (
						<>
							<section className="flex flex-col gap-2" aria-label="Top active observations">
								<div className="flex items-baseline justify-between gap-3">
									<h4 className="text-body font-semibold text-text">Top active observations</h4>
									<span className="text-label text-text-muted">First 10 loaded rows</span>
								</div>
								{preview.length === 0 ? (
									<p className="text-label text-text-muted">
										No available active-observation counts in the preview.
									</p>
								) : (
									<RankedBarList
										rows={preview}
										formatValue={({ value }) => formatExactValue(value, "observations")}
									/>
								)}
							</section>
							<RankingTable items={modeledRows} request={requestFor} onDrill={props.onDrill} />
						</>
					)}
					<div className="flex justify-end">
						<Button
							variant="secondary"
							disabled={allRecordsRequest === null}
							onClick={() => {
								if (allRecordsRequest !== null) {
									props.onDrill(allRecordsRequest);
								}
							}}
						>
							All records
						</Button>
					</div>
					{result.hasNextPage && !result.isError ? (
						<LoadMoreButton
							variant="secondary"
							className="self-center"
							label="Show more rankings"
							disabled={result.isFetching}
							onClick={result.fetchNextPage}
							isFetchingNextPage={result.isFetchingNextPage}
						/>
					) : null}
				</>
			) : null}
		</div>
	);
}
