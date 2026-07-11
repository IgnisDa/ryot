import { RyotClientError } from "@ryot-app/client-sdk";
import { fireEvent, getByRole } from "@testing-library/dom";
import { assert, describe, expect, it } from "vitest";

import {
	errorQueryResult,
	pendingQueryResult,
	readyQueryResult,
} from "../../tests/client/query-result-fixture";
import { decodeShowActivity } from "../../tests/client/show/activity-fixture";
import {
	decodeShowSeasonEpisodesResult,
	decodeShowSeasonsResult,
} from "../../tests/client/show/episodes-fixture";
import { decodeShowOverview } from "../../tests/client/show/overview-fixture";
import { decodeShowSummaryResult, showSummaryRow } from "../../tests/client/show/summary-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import { mapShowSeasons } from "../show/episodes-state";
import { showSchema } from "../show/schema";
import { mapMediaEpisodePage } from "./episodes-state";
import { mapMediaOverview } from "./overview-state";
import { MediaRefreshStatus } from "./primitives";
import { classifyRyotQueryResult } from "./query-state";

describe("show refresh failures", () => {
	it.each(["transport", "malformed-result"] as const)(
		"retains all decoded content after %s failure",
		(reason) => {
			const error = new RyotClientError(reason);
			const summary = errorQueryResult(
				error,
				decodeShowSummaryResult({ show: [showSummaryRow], requested: [{ schemaSlug: "show" }] }),
			);
			const overview = errorQueryResult(error, decodeShowOverview());
			const seasons = errorQueryResult(error, decodeShowSeasonsResult({}));
			const episodes = errorQueryResult(error, decodeShowSeasonEpisodesResult());
			const activity = errorQueryResult(error, decodeShowActivity());
			expect(mapShowSeasons(seasons).status).toBe("ready");
			expect(mapMediaEpisodePage(episodes).status).toBe("ready");
			expect(showSchema.mapActivity(activity).status).toBe("ready");
			let retries = 0;
			const retry = () => {
				retries += 1;
			};
			const view = mountRyotClient(
				{ query: () => Promise.resolve({}) },
				<showSchema.ScreenBody
					compact
					safeAreaTop={0}
					episodes={null}
					activity={null}
					refresh={retry}
					settled={undefined}
					refreshOverview={retry}
					overview={mapMediaOverview(overview)}
					state={showSchema.mapSummary(summary)}
					summaryRefreshStatus={<MediaRefreshStatus result={{ ...summary, refetch: retry }} />}
					overviewRefreshStatus={<MediaRefreshStatus result={{ ...overview, refetch: retry }} />}
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
		expect(mapShowSeasons(errorQueryResult(error, null)).status).toBe("empty");
		expect(classifyRyotQueryResult(errorQueryResult(error))).toEqual({ status: "transport-error" });
		expect(
			classifyRyotQueryResult(errorQueryResult(new RyotClientError("malformed-result"))),
		).toEqual({ status: "malformed" });
		const view = mountRyotClient(
			{ query: () => Promise.resolve({}) },
			<>
				<MediaRefreshStatus result={errorQueryResult(error)} />
				<MediaRefreshStatus result={pendingQueryResult()} />
				<MediaRefreshStatus result={readyQueryResult(null)} />
			</>,
		);
		expect(view.container.textContent).toBe("");
		view.unmount();
	});
});
