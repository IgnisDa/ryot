// @vitest-environment jsdom

import { createTestRyotClock } from "@ryot-app/client-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { showPresentationRecipe } from "../../shared/show-recipes";
import { mountRyotClient } from "../../tests/client/test-support";
import {
	loadShowPresentations,
	ShowCardContent,
	ShowRowContent,
	type ShowPresentationViewData,
} from "./presentation";

const rows = (items: readonly Record<string, unknown>[]) => ({
	items,
	type: "rows" as const,
	pageInfo: { limit: 100, hasMore: false, nextCursor: null },
});

const presentationRow = {
	id: "show-1",
	storedSeasons: 2,
	name: "Severance",
	publishDate: null,
	publishYear: 2022,
	storedEpisodes: 19,
	schemaSlug: "show",
	watchedEpisodes: 11,
	state: "in_progress",
	inProgressEpisodes: 1,
	populationStatus: "ready",
	translationStatus: "none",
	productionStatus: "Returning Series",
	images: [{ type: "remote", purpose: "cover", url: "https://images.test/severance.jpg" }],
};

const decodedData = (overrides: Record<string, unknown> = {}): ShowPresentationViewData => {
	const decoded = showPresentationRecipe(["show-1"]).decode({
		data: { shows: rows([{ ...presentationRow, ...overrides }]) },
	});
	if (decoded._tag === "Failure" || decoded.success[0] === undefined) {
		throw new Error("Expected decoded presentation data");
	}
	return { ...decoded.success[0], batchAssets: [] };
};

const reference = (entityId: string) => ({
	entityId,
	name: null,
	ownerPluginId: "media",
	entitySchemaSlug: "show",
	populationStatus: "ready" as const,
	translationStatus: "none" as const,
});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("show entity presentations", () => {
	it("loads visible shows once and shares the batch's deduplicated managed posters", async () => {
		const documents: unknown[] = [];
		const clock = createTestRyotClock({
			query: (document) => {
				documents.push(document);
				return Promise.resolve({
					data: {
						shows: rows([
							{
								...presentationRow,
								images: [{ type: "s3", purpose: "cover", key: "shared-cover" }],
							},
							{
								...presentationRow,
								id: "show-2",
								name: "Second Show",
								images: [{ type: "s3", purpose: "cover", key: "shared-cover" }],
							},
						]),
					},
				});
			},
		});
		const loaded = await loadShowPresentations({
			client: clock.client,
			signal: new AbortController().signal,
			references: [reference("show-2"), reference("show-1"), reference("show-2")],
		});

		expect(documents).toHaveLength(1);
		expect(Object.keys(loaded).sort()).toEqual(["show-1", "show-2"]);
		expect(loaded["show-1"]?.batchAssets).toEqual([{ type: "s3", key: "shared-cover" }]);
		expect(loaded["show-2"]?.batchAssets).toBe(loaded["show-1"]?.batchAssets);
		await clock.dispose();
	});

	it("renders useful compact grid and list facts with artwork and entity links", () => {
		const data = decodedData();
		const card = mountRyotClient(
			{ query: () => Promise.resolve({}) },
			<ShowCardContent compact data={data} entityId="show-1" />,
		);
		const row = mountRyotClient(
			{ query: () => Promise.resolve({}) },
			<ShowRowContent compact data={data} entityId="show-1" />,
		);

		for (const container of [card.container, row.container]) {
			expect(container.textContent).toContain("Severance");
			expect(container.textContent).toContain("2022");
			expect(container.textContent).toContain("Returning Series");
			expect(container.textContent).toContain("In progress");
			expect(container.textContent).toContain("2 stored seasons");
			expect(container.textContent).toContain("11 of 19 episodes watched");
			expect(container.textContent).toContain("1 episode in progress");
			expect(container.querySelector("img")?.getAttribute("src")).toBe(
				"https://images.test/severance.jpg",
			);
			expect(container.querySelector("a")?.getAttribute("href")).toBe("/e/show-1");
		}
		expect(card.container.querySelector('[data-layout="grid"]')).not.toBeNull();
		expect(row.container.querySelector('[data-layout="list"]')).not.toBeNull();
		card.unmount();
		row.unmount();
	});

	it("keeps sparse local data usable with the shared missing-art fallback", () => {
		const data = decodedData({
			images: null,
			storedSeasons: 0,
			publishYear: null,
			publishDate: null,
			storedEpisodes: 0,
			watchedEpisodes: 0,
			inProgressEpisodes: 0,
			productionStatus: null,
		});
		const view = mountRyotClient(
			{ query: () => Promise.resolve({}) },
			<ShowRowContent data={data} compact={false} entityId="show-1" />,
		);

		expect(view.container.textContent).toContain("Severance");
		expect(view.container.textContent).toContain("In progress");
		expect(view.container.textContent).not.toContain("stored episode");
		expect(view.container.querySelector("img")).toBeNull();
		expect(view.container.querySelector('[aria-hidden="true"]')).not.toBeNull();
		view.unmount();
	});
});
