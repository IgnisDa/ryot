import {
	nextPageCursor,
	paginationItems,
	useRyotInfiniteQuery,
} from "@ryot-app/plugin-client-sdk/react";
import { Field, LoadMoreButton, RadioGroup, Select, StatusMessage } from "@ryot-app/plugin-ui-sdk";
import { AppIcon } from "@ryot-app/plugin-ui-sdk/icon";
import clsx from "clsx";
import type { ReactNode } from "react";

import { podcastEpisodesQuery } from "../podcast/episodes-query";
import { activityLogSeasonsQuery, showSeasonChoicesQuery } from "./activity-log/queries";
import { type ActivityEpisode, episodeCode, seasonLabel } from "./activity-log/state";

export type EpisodePager = {
	readonly isError: boolean;
	readonly retry: () => void;
	readonly isPending: boolean;
	readonly hasNextPage: boolean;
	readonly fetchNextPage: () => void;
	readonly isFetchingNextPage: boolean;
	readonly choices: readonly ActivityEpisode[];
};

const FIRST_PAGE: null | string = null;

export function PodcastEpisodes(props: {
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

export function ShowEpisodes(props: {
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

export function ActivitySeasonSelector(props: {
	readonly entityId: string;
	readonly seasonNumber: number | undefined;
	readonly onSeason: (season: { readonly id: string; readonly seasonNumber: number }) => void;
}) {
	const query = useRyotInfiniteQuery(
		activityLogSeasonsQuery,
		{ entityId: props.entityId },
		{
			initialPageParam: FIRST_PAGE,
			getNextPageParam: nextPageCursor,
			getPageInput: (input, after) => ({ ...input, after }),
		},
	);
	const seasons = paginationItems(
		query.pages,
		(page) => page.items,
		(season) => season.id,
	);
	const choices = seasons.map((season) => ({
		value: String(season.seasonNumber),
		label: seasonLabel(season.seasonNumber),
	}));
	if (
		props.seasonNumber !== undefined &&
		!seasons.some((season) => season.seasonNumber === props.seasonNumber)
	) {
		choices.push({ value: String(props.seasonNumber), label: seasonLabel(props.seasonNumber) });
	}
	return (
		<div className="flex flex-col gap-2">
			<Field label="Season">
				{(control) => (
					<Select
						label="Season"
						id={control.id}
						choices={choices}
						value={String(props.seasonNumber ?? "")}
						checkIcon={<AppIcon size={16} name="check" />}
						chevronIcon={<AppIcon size={16} name="chevron-down" />}
						onChange={(value) => {
							const season = seasons.find((candidate) => candidate.seasonNumber === Number(value));
							if (season !== undefined) {
								props.onSeason(season);
							}
						}}
					/>
				)}
			</Field>
			{query.isPending ? <StatusMessage tone="pending">Loading seasons…</StatusMessage> : null}
			{query.isError ? (
				<StatusMessage tone="error" action={{ label: "Try again", onClick: query.retry }}>
					Unable to load seasons.
				</StatusMessage>
			) : null}
			{query.hasNextPage ? (
				<LoadMoreButton
					label="Load more seasons"
					disabled={query.isFetching}
					onClick={query.fetchNextPage}
					isFetchingNextPage={query.isFetchingNextPage}
				/>
			) : null}
		</div>
	);
}

export function EpisodeList(props: {
	readonly pager: EpisodePager;
	readonly emptyMessage: string;
	readonly family: "show" | "podcast";
	readonly selectedId: string | undefined;
	readonly onSelect: (id: string) => void;
	readonly stateLabel?: (episode: ActivityEpisode) => string | undefined;
}) {
	const { pager, family } = props;
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
		return <p className="text-text-muted">{props.emptyMessage}</p>;
	}
	return (
		<div className="flex flex-col gap-2">
			<RadioGroup
				label="Episode"
				value={props.selectedId}
				onChange={props.onSelect}
				className="max-h-56 overflow-y-auto rounded-md border border-border"
				options={pager.choices.map((episode) => {
					const state = props.stateLabel?.(episode);
					return {
						state,
						episode,
						value: episode.id,
						label: `${episodeCode({ family }, episode)}${state === undefined ? "" : ` · ${state}`}`,
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
								<span className="font-medium text-text">
									{episodeCode({ family }, option.episode)}
								</span>
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
