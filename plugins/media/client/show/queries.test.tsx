// @vitest-environment jsdom

import type { EntityInterest, RyotClientAdapter } from "@ryot-app/client-sdk";
import { useRyotQuery, type RyotQuery } from "@ryot-app/client-sdk/react";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";
import { act } from "react";
import { describe, expect, it } from "vitest";

import {
	collectionAddedEventRow,
	episodeReviewEventRow,
	regularSeasonRow,
	secondWatchDayRow,
	showBacklogEventRow,
} from "../../tests/client/show/activity-fixture";
import { showEpisodeRow, showSeasonRow } from "../../tests/client/show/episodes-fixture";
import {
	showCompanyRow,
	showPersonRow,
	showRecommendationRow,
} from "../../tests/client/show/overview-fixture";
import { rowsResult } from "../../tests/client/show/query-result-fixture";
import { showSummaryRow } from "../../tests/client/show/summary-fixture";
import { flushRyotClient, mountRyotClient } from "../../tests/client/test-support";
import { ShowEpisodesTab } from "./episodes";
import { ShowRefreshStatus } from "./primitives";
import {
	showActivityQuery,
	showEpisodesQuery,
	showOverviewQuery,
	showSeasonEpisodesQuery,
	showSummaryQuery,
} from "./queries";
import { classifyRyotQueryResult } from "./query-state";

// `createEntityRefresh` debounces an entity hint through the SDK schedule before refetching.
const ENTITY_REFRESH_DEBOUNCE_MS = 250;

const rows = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 100, hasMore: false, nextCursor: null });

const seasonsResponse = {
	data: {
		show: rows([
			{
				...showSummaryRow,
				seasons: rows([
					showSeasonRow,
					{ ...showSeasonRow, id: "season-2", seasonNumber: 2, name: "Season 2" },
				]),
			},
		]),
	},
};
const episodesResponse = {
	data: { season: rows([{ ...showSeasonRow, episodes: rows([showEpisodeRow]) }]) },
};

function RefreshSeasons() {
	const result = useRyotQuery(showEpisodesQuery, { entityId: "show-1" });
	return <button onClick={result.refetch}>Refresh seasons</button>;
}

const recordingAdapter = () => {
	const interests: EntityInterest[] = [];
	const disposed: EntityInterest[] = [];
	const hints: Array<Parameters<NonNullable<RyotClientAdapter["watchEntities"]>>[1]> = [];
	const requests: Array<{
		resolve: (data: unknown) => void;
		reject: (error: Error) => void;
		document: Parameters<RyotClientAdapter["query"]>[0];
	}> = [];
	const adapter: Partial<RyotClientAdapter> = {
		query: (document) =>
			new Promise((resolve, reject) => requests.push({ reject, resolve, document })),
		watchEntities: (interest, onUpdate) => {
			hints.push(onUpdate);
			interests.push(interest);
			return { update: (next) => interests.push(next), dispose: () => disposed.push(interest) };
		},
	};
	return { hints, adapter, requests, disposed, interests };
};

function queryBehavior<Input, Data>(
	name: string,
	query: RyotQuery<Input, Data>,
	input: Input,
	response: unknown,
	foreground: string[],
	visible: string[],
) {
	it(`${name} watches loaded display entities and retains them after a failed refresh`, async () => {
		const recording = recordingAdapter();
		function Probe() {
			const result = useRyotQuery(query, input);
			return (
				<>
					<p>{classifyRyotQueryResult(result).status}</p>
					<ShowRefreshStatus result={result} />
				</>
			);
		}
		const view = mountRyotClient(recording.adapter, <Probe />);
		await flushRyotClient();
		expect(recording.interests[0]).toEqual({ visible: [], foreground: [...foreground].sort() });
		await act(async () => {
			recording.requests[0]?.resolve(response);
			await Promise.resolve();
		});
		await waitFor(() => expect(view.container.textContent).toContain("ready"));
		expect(recording.interests.at(-1)).toEqual({
			visible: [...visible].sort(),
			foreground: [...foreground].sort(),
		});
		act(() => recording.hints[0]?.({ entityId: "show-1", reason: "populated" }));
		await view.advance(ENTITY_REFRESH_DEBOUNCE_MS);
		await waitFor(() => expect(recording.requests).toHaveLength(2));
		await act(async () => {
			recording.requests[1]?.reject(new Error("offline"));
			await Promise.resolve();
		});
		await waitFor(() =>
			expect(getByRole(view.container, "status").textContent).toContain("Refresh failed"),
		);
		expect(view.container.textContent).toContain("ready");
		expect(recording.interests.at(-1)).toEqual({
			visible: [...visible].sort(),
			foreground: [...foreground].sort(),
		});
		await act(() => fireEvent.click(getByRole(view.container, "button", { name: "Try again" })));
		await flushRyotClient();
		expect(recording.requests).toHaveLength(3);
		await act(async () => {
			recording.requests[2]?.resolve(response);
			await Promise.resolve();
		});
		await waitFor(() => expect(view.container.querySelector('[role="status"]')).toBeNull());
		view.unmount();
		expect(recording.disposed).toHaveLength(1);
	});
}

describe("show query entity interest", () => {
	queryBehavior(
		"summary",
		showSummaryQuery,
		{ entityId: "show-1" },
		{ data: { show: rows([showSummaryRow]), requested: rows([{ schemaSlug: "show" }]) } },
		["show-1"],
		["collection-1"],
	);
	queryBehavior(
		"overview",
		showOverviewQuery,
		{ entityId: "show-1" },
		{
			data: {
				people: rows([showPersonRow]),
				companies: rows([showCompanyRow]),
				recommendations: rows([showRecommendationRow]),
			},
		},
		["show-1"],
		["person-1", "company-1", "show-2"],
	);
	queryBehavior(
		"seasons",
		showEpisodesQuery,
		{ entityId: "show-1" },
		seasonsResponse,
		["show-1"],
		["season-1", "season-2"],
	);
	queryBehavior(
		"selected episodes",
		showSeasonEpisodesQuery,
		{ entityId: "show-1", seasonId: "season-1" },
		episodesResponse,
		["show-1", "season-1"],
		["episode-1"],
	);
	queryBehavior(
		"activity",
		showActivityQuery,
		{ entityId: "show-1" },
		{
			data: {
				episodeProgress: rows([]),
				totals: rows([{ watchCount: 0 }]),
				seasons: rows([regularSeasonRow]),
				parentEvents: rows([showBacklogEventRow]),
				episodeEvents: rows([episodeReviewEventRow]),
				collectionEvents: rows([collectionAddedEventRow]),
				watchDays: {
					type: "aggregate",
					items: [secondWatchDayRow],
					pageInfo: { limit: 1000, hasMore: false },
				},
			},
		},
		["show-1"],
		["season-1", "episode-1", "episode-2", "collection-1"],
	);

	it("keeps the selected child after a seasons refresh failure and replaces child interest on selection", async () => {
		const recording = recordingAdapter();
		const view = mountRyotClient(
			recording.adapter,
			<>
				<RefreshSeasons />
				<ShowEpisodesTab compact entityId="show-1" />
			</>,
		);
		await flushRyotClient();
		await act(async () => {
			recording.requests[0]?.resolve(seasonsResponse);
			await Promise.resolve();
		});
		await flushRyotClient();
		await act(async () => {
			recording.requests[1]?.resolve(episodesResponse);
			await Promise.resolve();
		});
		await waitFor(() => expect(view.container.textContent).toContain(showEpisodeRow.name));
		await act(() => fireEvent.click(getByRole(view.container, "radio", { name: "Season 2" })));
		await flushRyotClient();
		expect(view.container.textContent).not.toContain(showEpisodeRow.name);
		expect(view.container.textContent).toContain("Loading season");
		expect(recording.interests.at(-1)).toEqual({ visible: [], foreground: ["season-2", "show-1"] });
		expect(JSON.stringify(recording.requests[2]?.document)).toContain("season-2");
		await act(async () => {
			recording.requests[2]?.resolve({
				data: {
					season: rows([
						{
							...showSeasonRow,
							id: "season-2",
							episodes: rows([{ ...showEpisodeRow, id: "episode-2", name: "Aftermath" }]),
						},
					]),
				},
			});
			await Promise.resolve();
		});
		await waitFor(() => expect(view.container.textContent).toContain("Aftermath"));
		expect(recording.interests.at(-1)).toEqual({
			visible: ["episode-2"],
			foreground: ["season-2", "show-1"],
		});
		expect(recording.disposed).toContainEqual({ visible: [], foreground: ["season-1", "show-1"] });
		await act(() =>
			fireEvent.click(getByRole(view.container, "button", { name: "Refresh seasons" })),
		);
		await flushRyotClient();
		await act(async () => {
			recording.requests[3]?.reject(new Error("offline"));
			await Promise.resolve();
		});
		await waitFor(() =>
			expect(getByRole(view.container, "status").textContent).toContain("Refresh failed"),
		);
		expect(
			getByRole(view.container, "radio", { name: "Season 2" }).getAttribute("aria-checked"),
		).toBe("true");
		expect(view.container.textContent).toContain("Aftermath");
		expect(view.container.textContent).not.toContain(showEpisodeRow.name);
		expect(recording.requests).toHaveLength(4);
		view.unmount();
	});
});
