import type { EntityInterest, RyotClientAdapter } from "@ryot-app/client-sdk";
import { useRyotQuery, type RyotQuery } from "@ryot-app/client-sdk/react";
import { waitFor } from "@testing-library/dom";
import { act } from "react";
import { describe, expect, it } from "vitest";

import {
	collectionAddedEventRow,
	movieProgressEventRow,
} from "../../tests/client/movie/activity-fixture";
import {
	movieCompanyRow,
	movieGroupMemberRow,
	movieGroupRow,
	moviePersonRow,
	movieRecommendationRow,
} from "../../tests/client/movie/overview-fixture";
import { movieSummaryRow } from "../../tests/client/movie/summary-fixture";
import { rowsResult } from "../../tests/client/query-result-fixture";
import { flushRyotClient, mountRyotClient } from "../../tests/client/test-support";
import { classifyRyotQueryResult } from "../media/query-state";
import { movieActivityQuery, movieOverviewQuery, movieSummaryQuery } from "./queries";

const rows = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 100, hasMore: false, nextCursor: null });

const recordingAdapter = () => {
	const interests: EntityInterest[] = [];
	const requests: Array<{ resolve: (data: unknown) => void }> = [];
	const adapter: Partial<RyotClientAdapter> = {
		query: () => new Promise((resolve) => requests.push({ resolve })),
		watchEntities: (interest) => {
			interests.push(interest);
			return { dispose: () => undefined, update: (next) => interests.push(next) };
		},
	};
	return { adapter, requests, interests };
};

const declaresInterest = <Input, Data>(
	name: string,
	query: RyotQuery<Input, Data>,
	input: Input,
	response: unknown,
	visible: readonly string[],
) => {
	it(`${name} watches every entity it renders`, async () => {
		const recording = recordingAdapter();
		function Probe() {
			return <p>{classifyRyotQueryResult(useRyotQuery(query, input)).status}</p>;
		}
		const view = mountRyotClient(recording.adapter, <Probe />);
		await flushRyotClient();
		await act(async () => {
			recording.requests[0]?.resolve(response);
			await Promise.resolve();
		});
		await waitFor(() => expect(view.container.textContent).toContain("ready"));

		expect(recording.interests.at(-1)).toEqual({
			foreground: ["movie-1"],
			visible: [...visible].sort(),
		});
		view.unmount();
	});
};

describe("movie query entity interest", () => {
	declaresInterest(
		"summary",
		movieSummaryQuery,
		{ entityId: "movie-1" },
		{ data: { movie: rows([movieSummaryRow]), requested: rows([{ schemaSlug: "movie" }]) } },
		["collection-1"],
	);
	declaresInterest(
		"overview",
		movieOverviewQuery,
		{ entityId: "movie-1" },
		{
			data: {
				people: rows([moviePersonRow]),
				companies: rows([movieCompanyRow]),
				recommendations: rows([movieRecommendationRow]),
				group: rows([{ ...movieGroupRow, members: rows([movieGroupMemberRow]) }]),
			},
		},
		["person-1", "company-1", "movie-2", "movie-3"],
	);
	declaresInterest(
		"activity",
		movieActivityQuery,
		{ entityId: "movie-1" },
		{
			data: {
				movieEvents: rows([movieProgressEventRow]),
				collectionEvents: rows([collectionAddedEventRow]),
				totals: rows([{ completionCount: 1, consumedMinutes: 169, unknownDurationCount: 0 }]),
			},
		},
		["collection-1"],
	);
});
