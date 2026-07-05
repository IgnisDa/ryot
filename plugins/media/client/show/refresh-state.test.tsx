// @vitest-environment jsdom

import { RyotClientError } from "@ryot-app/client-sdk";
import { fireEvent, getByRole } from "@testing-library/dom";
import { assert, describe, expect, it } from "vitest";

import { decodeShowActivity } from "./activity-fixture";
import { mapShowActivity } from "./activity-state";
import { decodeShowEpisodesResult, decodeShowSeasonEpisodesResult } from "./episodes-fixture";
import { mapShowEpisodes, mapShowSeasonEpisodes } from "./episodes-state";
import { decodeShowOverview } from "./overview-fixture";
import { mapShowOverview } from "./overview-state";
import { ShowRefreshStatus } from "./primitives";
import { errorQueryResult, pendingQueryResult, readyQueryResult } from "./query-result-fixture";
import { classifyRyotQueryResult } from "./query-state";
import { ShowScreenBody } from "./screen";
import { decodeShowSummaryResult, showSummaryRow } from "./summary-fixture";
import { mapShowSummary } from "./summary-state";
import { mountRyotClient } from "./test-support";

describe("show refresh failures", () => {
	it.each(["transport", "malformed-result"] as const)(
		"retains all decoded content after %s failure",
		(reason) => {
			const error = new RyotClientError(reason);
			const summary = errorQueryResult(
				error,
				decodeShowSummaryResult({ requested: [{ schemaSlug: "show" }], show: [showSummaryRow] }),
			);
			const overview = errorQueryResult(error, decodeShowOverview());
			const seasons = errorQueryResult(error, decodeShowEpisodesResult({}));
			const episodes = errorQueryResult(error, decodeShowSeasonEpisodesResult({}));
			const activity = errorQueryResult(error, decodeShowActivity());
			expect(mapShowEpisodes(seasons).status).toBe("ready");
			expect(mapShowSeasonEpisodes(episodes).status).toBe("ready");
			expect(mapShowActivity(activity).status).toBe("ready");
			let retries = 0;
			const retry = () => {
				retries += 1;
			};
			const view = mountRyotClient(
				{ query: () => Promise.resolve({}) },
				<ShowScreenBody
					compact
					episodes={null}
					activity={null}
					refresh={retry}
					refreshOverview={retry}
					state={mapShowSummary(summary)}
					overview={mapShowOverview(overview)}
					summaryRefreshStatus={<ShowRefreshStatus result={{ ...summary, refetch: retry }} />}
					overviewRefreshStatus={<ShowRefreshStatus result={{ ...overview, refetch: retry }} />}
				/>,
			);
			expect(view.container.textContent).toContain("Adolescence");
			expect(view.container.textContent).toContain("Owen Cooper");
			expect(view.container.querySelectorAll('[role="status"]')).toHaveLength(2);
			const status = view.container.querySelector('[role="status"]');
			assert(status instanceof HTMLElement);
			fireEvent.click(getByRole(status, "button", { name: "Try again" }));
			expect(retries).toBe(1);
			view.unmount();
		},
	);

	it("keeps null data authoritative and reserves initial errors for missing data", () => {
		const error = new RyotClientError("transport");
		expect(mapShowEpisodes(errorQueryResult(error, null)).status).toBe("empty");
		expect(mapShowSeasonEpisodes(errorQueryResult(error, null)).status).toBe("empty");
		expect(classifyRyotQueryResult(errorQueryResult(error))).toEqual({ status: "transport-error" });
		expect(
			classifyRyotQueryResult(errorQueryResult(new RyotClientError("malformed-result"))),
		).toEqual({ status: "malformed" });
		const view = mountRyotClient(
			{ query: () => Promise.resolve({}) },
			<>
				<ShowRefreshStatus result={errorQueryResult(error)} />
				<ShowRefreshStatus result={pendingQueryResult()} />
				<ShowRefreshStatus result={readyQueryResult(null)} />
			</>,
		);
		expect(view.container.textContent).toBe("");
		view.unmount();
	});
});
