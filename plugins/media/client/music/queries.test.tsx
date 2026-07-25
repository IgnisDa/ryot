import type { EntityInterest, RyotClientAdapter } from "@ryot-app/client-sdk";
import { useRyotQuery, type RyotQuery } from "@ryot-app/client-sdk/react";
import { waitFor } from "@testing-library/dom";
import { act } from "react";
import { describe, expect, it } from "vitest";

import {
	musicCollectionAddedEventRow,
	musicProgressEventRow,
} from "../../tests/client/music/activity-fixture";
import {
	musicCompanyRow,
	musicGroupMemberRow,
	musicGroupRow,
	musicPersonRow,
	musicRecommendationRow,
} from "../../tests/client/music/overview-fixture";
import { musicSummaryRow } from "../../tests/client/music/summary-fixture";
import { rowsResult } from "../../tests/client/query-result-fixture";
import { flushRyotClient, mountRyotClient } from "../../tests/client/test-support";
import { classifyRyotQueryResult } from "../media/query-state";
import { musicActivityQuery, musicOverviewQuery, musicSummaryQuery } from "./queries";

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
			foreground: ["music-1"],
			visible: [...visible].sort(),
		});
		view.unmount();
	});
};

describe("music query entity interest", () => {
	declaresInterest(
		"summary",
		musicSummaryQuery,
		{ entityId: "music-1" },
		{ data: { music: rows([musicSummaryRow]), requested: rows([{ schemaSlug: "music" }]) } },
		["collection-1"],
	);
	declaresInterest(
		"overview",
		musicOverviewQuery,
		{ entityId: "music-1" },
		{
			data: {
				people: rows([musicPersonRow]),
				companies: rows([musicCompanyRow]),
				recommendations: rows([musicRecommendationRow]),
				group: rows([{ ...musicGroupRow, members: rows([musicGroupMemberRow]) }]),
			},
		},
		["person-1", "company-1", "music-2", "music-3"],
	);
	declaresInterest(
		"activity",
		musicActivityQuery,
		{ entityId: "music-1" },
		{
			data: {
				musicEvents: rows([musicProgressEventRow]),
				collectionEvents: rows([musicCollectionAddedEventRow]),
				totals: rows([{ completionCount: 1, consumedMinutes: 3.7, unknownDurationCount: 0 }]),
			},
		},
		["collection-1"],
	);
});
