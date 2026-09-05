import { afterEach, describe, expect, it } from "vitest";

import { moviePresentationRecipe } from "../../shared/movie-recipes";
import { mountRyotClient } from "../../tests/client/test-support";
import { MovieCardContent, MovieRowContent, type MoviePresentationViewData } from "./presentation";

const rows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

const presentationRow = {
	runtime: 169,
	id: "movie-1",
	publishDate: null,
	publishYear: 1999,
	name: "Fight Club",
	schemaSlug: "movie",
	progressPercent: 42,
	state: "in_progress",
	populationStatus: "ready",
	translationStatus: "none",
	productionStatus: "Released",
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/fc.jpg" }],
};

const decodedData = (overrides: Record<string, unknown> = {}): MoviePresentationViewData => {
	const decoded = moviePresentationRecipe(["movie-1"]).decode({
		data: { movies: rows([{ ...presentationRow, ...overrides }]) },
	});
	if (decoded._tag === "Failure" || decoded.success[0] === undefined) {
		throw new Error("Expected decoded presentation data");
	}
	return { ...decoded.success[0], batchAssets: [] };
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("movie entity presentations", () => {
	it("shows the year, runtime and lifecycle state on the row", () => {
		const { unmount, container } = mountRyotClient(
			{ query: () => Promise.resolve({}) },
			<MovieRowContent compact entityId="movie-1" data={decodedData()} />,
		);

		expect(container.textContent).toContain("1999");
		expect(container.textContent).toContain("2h 49m");
		expect(container.textContent).toContain("In progress");
		unmount();
	});

	it("hints at recorded progress only while the movie is in progress", () => {
		const inProgress = mountRyotClient(
			{ query: () => Promise.resolve({}) },
			<MovieCardContent compact entityId="movie-1" data={decodedData()} />,
		);
		expect(inProgress.container.textContent).toContain("42% watched");
		inProgress.unmount();

		const complete = mountRyotClient(
			{ query: () => Promise.resolve({}) },
			<MovieCardContent
				compact
				entityId="movie-1"
				data={decodedData({ state: "complete", progressPercent: 42 })}
			/>,
		);
		expect(complete.container.textContent).not.toContain("42% watched");
		expect(complete.container.textContent).toContain("Complete");
		complete.unmount();
	});

	it("omits a runtime the provider never recorded", () => {
		const { unmount, container } = mountRyotClient(
			{ query: () => Promise.resolve({}) },
			<MovieRowContent compact entityId="movie-1" data={decodedData({ runtime: null })} />,
		);

		expect(container.textContent).not.toContain("2h 49m");
		expect(container.textContent).toContain("1999");
		unmount();
	});
});
