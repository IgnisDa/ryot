import type { RyotClientAdapter } from "@ryot-app/client-sdk";
import { fireEvent, waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import {
	episodicEpisode,
	episodicEpisodePageData,
	episodicFixtureEpisodesQuery,
	EPISODIC_FIXTURE_RENDER,
} from "../../tests/client/episodic/episodes-fixture";
import { flushRyotClient, mountRyotClient } from "../../tests/client/test-support";
import { MediaEpisodePages, type MediaEpisodePagesCopy } from "./episodes";
import { mediaEpisodePageError } from "./episodes-state";

const COPY: MediaEpisodePagesCopy = {
	empty: "No episodes have been recorded yet.",
	error: (state) => mediaEpisodePageError({ state, noun: "episodes" }),
	loading: { title: "Loading episodes...", detail: "Fetching this feed's episodes." },
};

const FIRST_PAGE = [
	episodicEpisode({ name: "Nine", id: "episode-9", episodeNumber: 9, state: "untracked" }),
	episodicEpisode({ name: "Eight", id: "episode-8", episodeNumber: 8, state: "complete" }),
];

const SECOND_PAGE = [
	episodicEpisode({ name: "Seven", id: "episode-7", episodeNumber: 7, state: "untracked" }),
];

function Pages() {
	return (
		<MediaEpisodePages
			compact
			copy={COPY}
			nextUp="latest"
			entityId="parent-1"
			containerId="parent-1"
			render={EPISODIC_FIXTURE_RENDER}
			query={episodicFixtureEpisodesQuery}
		/>
	);
}

const loadMore = (container: HTMLElement) =>
	Array.from(container.querySelectorAll("button")).find(
		(button) => button.textContent === "Load more",
	);

const pagingAdapter = () => {
	const documents: unknown[] = [];
	const adapter: Partial<RyotClientAdapter> = {
		query: (document) => {
			documents.push(document);
			return Promise.resolve(
				JSON.stringify(document).includes("cursor-1")
					? episodicEpisodePageData({ episodes: SECOND_PAGE })
					: episodicEpisodePageData({ episodes: FIRST_PAGE, nextCursor: "cursor-1" }),
			);
		},
	};
	return { adapter, documents };
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("media episode pages", () => {
	it("renders the first page with its leading slot and a load-more control", async () => {
		const { adapter, documents } = pagingAdapter();
		const view = mountRyotClient(adapter, <Pages />);
		await flushRyotClient();

		await waitFor(() => expect(view.container.textContent).toContain("Nine"));
		expect(view.container.textContent).toContain("Eight");
		expect(view.container.textContent).toContain("Next up");
		expect(view.container.textContent).not.toContain("Seven");
		expect(documents).toHaveLength(1);
		expect(loadMore(view.container)).not.toBeUndefined();
		view.unmount();
	});

	it("appends the next page without refetching the pages already on screen", async () => {
		const { adapter, documents } = pagingAdapter();
		const view = mountRyotClient(adapter, <Pages />);
		await flushRyotClient();
		await waitFor(() => expect(view.container.textContent).toContain("Nine"));

		const control = loadMore(view.container);
		if (control === undefined) {
			throw new Error("Expected the load more control");
		}
		fireEvent.click(control);
		await flushRyotClient();

		await waitFor(() => expect(view.container.textContent).toContain("Seven"));
		expect(view.container.textContent).toContain("Nine");
		expect(documents).toHaveLength(2);
		expect(loadMore(view.container)).toBeUndefined();
		view.unmount();
	});

	it("explains an empty feed and keeps the control away from a single page", async () => {
		const view = mountRyotClient(
			{ query: () => Promise.resolve(episodicEpisodePageData({ episodes: [] })) },
			<Pages />,
		);
		await flushRyotClient();

		await waitFor(() =>
			expect(view.container.textContent).toContain("No episodes have been recorded yet."),
		);
		expect(loadMore(view.container)).toBeUndefined();
		view.unmount();
	});

	it("keeps a page failure behind stable copy", async () => {
		const view = mountRyotClient({ query: () => Promise.reject(new Error("offline")) }, <Pages />);
		await flushRyotClient();

		await waitFor(() =>
			expect(view.container.textContent).toContain("Unable to load these episodes"),
		);
		view.unmount();
	});
});
