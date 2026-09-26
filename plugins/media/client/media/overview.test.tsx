import { fireEvent, waitFor } from "@testing-library/dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
	decodeShowOverview,
	emptyShowOverview,
	showCompanyRow,
	showPersonRow,
	showRecommendationRow,
} from "../../tests/client/show/overview-fixture";
import { decodeShowSummary } from "../../tests/client/show/summary-fixture";
import { mountRyotClient } from "../../tests/client/test-support";
import {
	mediaWatchProvidersTrailing,
	MediaOverview,
	MediaOverviewRelations,
	MediaWatchProvidersSection,
	type MediaOverviewRelationsRender,
} from "./overview";
import { mediaRelationsAreEmpty, type MediaOverviewState } from "./overview-state";
import { watchProviderGroups, watchProviderLink } from "./watch-providers";

const noopAdapter = { query: () => Promise.resolve({}) };

const relationsRender: MediaOverviewRelationsRender<Overview> = ({ divided, overview }) => (
	<MediaOverviewRelations
		compact
		aspect="poster"
		divided={divided}
		overview={overview}
		onViewAllPeople={() => undefined}
		copy={{ notice: "Cast", people: "Cast & crew", companies: "Production companies" }}
	/>
);

type Overview = ReturnType<typeof decodeShowOverview>;

const readyOverview = decodeShowOverview();

const watchProvidersTrailing = mediaWatchProvidersTrailing<ReturnType<typeof decodeShowSummary>>(
	(summary) => summary,
);

const overviewScreen = (input: {
	readonly media?: ReturnType<typeof decodeShowSummary>;
	readonly overview: MediaOverviewState<Overview>;
	readonly refreshOverview?: () => void;
	readonly trailing?: (slot: { readonly compact: boolean; readonly divided: boolean }) => ReactNode;
}) => {
	const media = input.media ?? decodeShowSummary();
	return (
		<MediaOverview
			compact
			media={media}
			safeAreaTop={0}
			noticeTitle="Cast"
			overview={input.overview}
			relations={relationsRender}
			isEmpty={mediaRelationsAreEmpty}
			refreshOverview={input.refreshOverview ?? (() => undefined)}
			loadingDetail="Fetching the cast, companies and recommendations for this show."
			trailing={input.trailing ?? ((slot) => watchProvidersTrailing({ ...slot, summary: media }))}
		/>
	);
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("MediaOverview", () => {
	it("renders the gallery, cast, companies and recommendations from a ready overview", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			overviewScreen({ overview: { status: "ready", overview: readyOverview } }),
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
			overviewScreen({ overview: { status: "ready", overview: emptyShowOverview() } }),
		);

		expect(container.textContent).toContain("Images");
		expect(container.textContent).not.toContain("Cast & crew");
		expect(container.textContent).not.toContain("Production companies");
		expect(container.textContent).not.toContain("More like this");
		unmount();
	});

	it("renders each offer group, the region attribution and the link for the region", () => {
		const media = decodeShowSummary();
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<MediaWatchProvidersSection
				compact
				region="US"
				divided={false}
				link={watchProviderLink(media, "US")}
				groups={watchProviderGroups(media, "US")}
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
			overviewScreen({
				media: decodeShowSummary({ watchProviders: null }),
				overview: { status: "ready", overview: readyOverview },
			}),
		);

		expect(container.textContent).not.toContain("Where to watch");
		expect(container.textContent).not.toContain("JustWatch");
		unmount();
	});

	it("renders the trailing slot last and divides it from the sections above", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			overviewScreen({
				overview: { status: "ready", overview: readyOverview },
				trailing: ({ divided }) => <section data-divided={divided}>Where to play</section>,
			}),
		);

		expect(container.textContent).toContain("Where to play");
		expect(container.firstElementChild?.lastElementChild?.textContent).toBe("Where to play");
		expect(container.firstElementChild?.lastElementChild?.getAttribute("data-divided")).toBe(
			"true",
		);
		unmount();
	});

	it("shows a loading notice while the overview is loading", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			overviewScreen({ overview: { status: "loading" } }),
		);

		expect(container.textContent).toContain("Loading details...");
		unmount();
	});

	it("retries a failed overview load through the refresh callback", async () => {
		let refreshCount = 0;
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			overviewScreen({
				overview: { status: "transport-error" },
				refreshOverview: () => {
					refreshCount += 1;
				},
			}),
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
