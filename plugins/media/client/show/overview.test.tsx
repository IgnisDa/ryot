// @vitest-environment jsdom

import { fireEvent, waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import {
	decodeShowOverview,
	emptyShowOverview,
	showCompanyRow,
	showPersonRow,
	showRecommendationRow,
} from "../../tests/client/show/overview-fixture";
import { decodeShowSummary } from "../../tests/client/show/summary-fixture";
import { mountRyotClient } from "../../tests/client/show/test-support";
import { ShowOverview, ShowWatchProvidersSection } from "./overview";
import { watchProviderGroups, watchProviderLink } from "./watch-providers";

const noopAdapter = { query: () => Promise.resolve({}) };

const readyOverview = decodeShowOverview();

afterEach(() => {
	document.body.innerHTML = "";
});

describe("ShowOverview", () => {
	it("renders the gallery, cast, companies and recommendations from a ready overview", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<ShowOverview
				compact
				show={decodeShowSummary()}
				refreshOverview={() => undefined}
				overview={{ status: "ready", overview: readyOverview }}
			/>,
		);

		expect(container.textContent).toContain("Images");
		expect(container.textContent).toContain(showPersonRow.name);
		expect(container.textContent).toContain(showCompanyRow.name);
		expect(container.textContent).toContain(showRecommendationRow.name);
		expect(container.querySelector(`a[href="/e/${showPersonRow.id}"]`)).not.toBeNull();
		expect(container.querySelector(`a[href="/e/${showCompanyRow.id}"]`)).not.toBeNull();
		expect(container.querySelector(`a[href="/e/${showRecommendationRow.id}"]`)).not.toBeNull();
		unmount();
	});

	it("omits the cast, companies and recommendations sections when the overview has none", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<ShowOverview
				compact
				show={decodeShowSummary()}
				refreshOverview={() => undefined}
				overview={{ status: "ready", overview: emptyShowOverview() }}
			/>,
		);

		expect(container.textContent).toContain("Images");
		expect(container.textContent).not.toContain("Cast & crew");
		expect(container.textContent).not.toContain("Production companies");
		expect(container.textContent).not.toContain("More like this");
		unmount();
	});

	it("renders each offer group, the region attribution and the link for the region", () => {
		const show = decodeShowSummary();
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<ShowWatchProvidersSection
				compact
				region="US"
				divided={false}
				link={watchProviderLink(show, "US")}
				groups={watchProviderGroups(show, "US")}
			/>,
		);

		expect(container.textContent).toContain("Where to watch");
		expect(container.textContent).toContain("Stream");
		expect(container.textContent).toContain("Netflix");
		expect(container.textContent).toContain("Apple TV");
		expect(container.textContent).toContain("Availability in United States, from JustWatch.");
		expect(
			container.querySelector('a[href="https://www.themoviedb.org/tv/1/watch?locale=US"]'),
		).not.toBeNull();
		unmount();
	});

	it("omits the watch providers section when the region carries none", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<ShowOverview
				compact
				refreshOverview={() => undefined}
				show={decodeShowSummary({ watchProviders: null })}
				overview={{ status: "ready", overview: readyOverview }}
			/>,
		);

		expect(container.textContent).not.toContain("Where to watch");
		expect(container.textContent).not.toContain("JustWatch");
		unmount();
	});

	it("shows a loading notice while the overview is loading", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<ShowOverview
				compact
				show={decodeShowSummary()}
				overview={{ status: "loading" }}
				refreshOverview={() => undefined}
			/>,
		);

		expect(container.textContent).toContain("Loading details...");
		unmount();
	});

	it("retries a failed overview load through the refresh callback", async () => {
		let refreshCount = 0;
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<ShowOverview
				compact
				show={decodeShowSummary()}
				overview={{ status: "transport-error" }}
				refreshOverview={() => {
					refreshCount += 1;
				}}
			/>,
		);

		expect(container.textContent).toContain("Unable to load these details");
		const retry = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Try again",
		);
		if (retry === undefined) {
			throw new Error("Expected the overview retry button");
		}
		fireEvent.click(retry);
		await waitFor(() => expect(refreshCount).toBe(1));
		unmount();
	});
});
