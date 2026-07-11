import { afterEach, describe, expect, it } from "vitest";

import { musicPresentationRecipe } from "../../shared/music-recipes";
import { mountRyotClient } from "../../tests/client/test-support";
import { MusicCardContent, MusicRowContent, type MusicPresentationViewData } from "./presentation";

const noopAdapter = { query: () => Promise.resolve({}) };

const rows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

const presentationRow = {
	duration: 222,
	id: "music-1",
	publishDate: null,
	publishYear: 1997,
	schemaSlug: "music",
	progressPercent: 42,
	state: "in_progress",
	name: "Paranoid Android",
	populationStatus: "ready",
	translationStatus: "none",
	productionStatus: "Released",
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/ok-computer.jpg" }],
};

const decodedData = (overrides: Record<string, unknown> = {}): MusicPresentationViewData => {
	const decoded = musicPresentationRecipe(["music-1"]).decode({
		data: { music: rows([{ ...presentationRow, ...overrides }]) },
	});
	if (decoded._tag === "Failure" || decoded.success[0] === undefined) {
		throw new Error("Expected decoded presentation data");
	}
	return { ...decoded.success[0], batchAssets: [] };
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("music entity presentations", () => {
	it("shows the year, track length and lifecycle state on the row", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<MusicRowContent compact entityId="music-1" data={decodedData()} />,
		);

		expect(container.textContent).toContain("1997");
		expect(container.textContent).toContain("3:42");
		expect(container.textContent).toContain("In progress");
		unmount();
	});

	it("draws square cover art rather than a poster", () => {
		const card = mountRyotClient(
			noopAdapter,
			<MusicCardContent compact entityId="music-1" data={decodedData()} />,
		);
		expect(card.container.querySelector("article > a > *")?.className).toContain("aspect-square");
		card.unmount();

		const row = mountRyotClient(
			noopAdapter,
			<MusicRowContent compact entityId="music-1" data={decodedData()} />,
		);
		expect(row.container.querySelector("article > a > *")?.className).toContain("h-20 w-20");
		row.unmount();
	});

	it("hints at recorded progress only while the track is in progress", () => {
		const inProgress = mountRyotClient(
			noopAdapter,
			<MusicCardContent compact entityId="music-1" data={decodedData()} />,
		);
		expect(inProgress.container.textContent).toContain("42% played");
		inProgress.unmount();

		const complete = mountRyotClient(
			noopAdapter,
			<MusicCardContent
				compact
				entityId="music-1"
				data={decodedData({ state: "complete", progressPercent: 42 })}
			/>,
		);
		expect(complete.container.textContent).not.toContain("42% played");
		expect(complete.container.textContent).toContain("Complete");
		complete.unmount();
	});

	it("omits a duration the provider never recorded", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<MusicRowContent compact entityId="music-1" data={decodedData({ duration: null })} />,
		);

		expect(container.textContent).not.toContain("3:42");
		expect(container.textContent).toContain("1997");
		unmount();
	});
});
