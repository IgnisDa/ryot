import type { RyotClientAdapter, RyotNavigationTarget } from "@ryot-app/client-sdk";
import { getByRole, waitFor } from "@testing-library/dom";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { flatRow, rows } from "../../tests/client/home/fixtures";
import {
	clickRyotElement,
	flushRyotClient,
	mountRyotClient,
} from "../../tests/client/test-support";
import { HomeBody } from "./screen";

const libraryCount = (count: number) => ({ type: "aggregate", items: [{ count }] });

const inProgressMovie = flatRow("movie-1", "Heat", "movie", {
	progressPercent: 40,
	latestActivityAt: "2026-09-24T10:00:00.000Z",
});

type Responses = Readonly<Record<string, unknown>>;

/**
 * Answers every query of a document from `responses`, empty rows by default; `gate` replaces the
 * library count response and may be an error or a promise that never settles.
 */
const homeAdapter = (input: {
	readonly responses?: Responses;
	readonly gate: number | "error" | "pending";
}) => {
	const requested: string[][] = [];
	const navigations: RyotNavigationTarget[] = [];
	const providerSearches: unknown[] = [];
	const adapter: Partial<RyotClientAdapter> = {
		navigate: (_mode, target) => {
			navigations.push(target);
		},
		openProviderSearch: (request) => {
			providerSearches.push(request);
		},
		watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
		query: (document) => {
			const names = Object.keys(document.queries);
			requested.push(names);
			if (names.includes("library")) {
				if (input.gate === "pending") {
					return new Promise(() => undefined);
				}
				if (input.gate === "error") {
					return Promise.reject(new Error("offline"));
				}
				return Promise.resolve({ data: { library: libraryCount(input.gate) } });
			}
			return Promise.resolve({
				data: Object.fromEntries(names.map((name) => [name, input.responses?.[name] ?? rows([])])),
			});
		},
	};
	return { adapter, requested, navigations, providerSearches };
};

const mountHome = (adapter: Partial<RyotClientAdapter>) =>
	mountRyotClient(adapter, <HomeBody compact scrollRootRef={{ current: null }} />);

const observers: RecordingIntersectionObserver[] = [];

class RecordingIntersectionObserver implements IntersectionObserver {
	readonly root: Element | Document | null;
	readonly rootMargin: string;
	readonly thresholds: readonly number[] = [];
	readonly scrollMargin = "";
	readonly targets = new Set<Element>();

	constructor(
		private readonly callback: IntersectionObserverCallback,
		options?: IntersectionObserverInit,
	) {
		this.root = options?.root ?? null;
		this.rootMargin = options?.rootMargin ?? "";
		observers.push(this);
	}

	observe(target: Element) {
		this.targets.add(target);
	}

	unobserve(target: Element) {
		this.targets.delete(target);
	}

	disconnect() {
		this.targets.clear();
	}

	takeRecords() {
		return [];
	}

	intersect() {
		this.callback(
			Array.from(this.targets, (target) => ({
				target,
				time: 0,
				rootBounds: null,
				intersectionRatio: 1,
				isIntersecting: true,
				intersectionRect: target.getBoundingClientRect(),
				boundingClientRect: target.getBoundingClientRect(),
			})),
			this,
		);
	}
}

const originalIntersectionObserver = globalThis.IntersectionObserver;

afterEach(() => {
	globalThis.IntersectionObserver = originalIntersectionObserver;
	observers.length = 0;
	document.body.innerHTML = "";
});

describe("home gate", () => {
	it("shows a page skeleton while the library count is pending", async () => {
		const view = mountHome(homeAdapter({ gate: "pending" }).adapter);
		await flushRyotClient();
		expect(view.container.querySelector('[aria-label="Loading your media"]')).not.toBeNull();
		view.unmount();
	});

	it("shows the first-run panel for an empty library", async () => {
		const view = mountHome(homeAdapter({ gate: 0 }).adapter);
		await waitFor(() => expect(view.container.textContent).toContain("Start your media library"));
		view.unmount();
	});

	it("shows the rails for a library with media", async () => {
		const view = mountHome(
			homeAdapter({ gate: 1, responses: { "flat.items": rows([inProgressMovie]) } }).adapter,
		);
		await waitFor(() => expect(view.container.textContent).toContain("Continue"));
		expect(view.container.textContent).not.toContain("Start your media library");
		view.unmount();
	});

	it("fails open to the rails when the library count errors", async () => {
		const view = mountHome(
			homeAdapter({ gate: "error", responses: { "flat.items": rows([inProgressMovie]) } }).adapter,
		);
		await waitFor(() => expect(view.container.textContent).toContain("Heat"));
		expect(view.container.textContent).not.toContain("Start your media library");
		view.unmount();
	});

	it("falls back to first run when the count errors and every eager rail is empty", async () => {
		const view = mountHome(homeAdapter({ gate: "error" }).adapter);
		await waitFor(() => expect(view.container.textContent).toContain("Start your media library"));
		view.unmount();
	});
});

describe("home sections", () => {
	it("runs eager sections as their own documents and mounts the rest near the viewport", async () => {
		globalThis.IntersectionObserver = RecordingIntersectionObserver;
		const home = homeAdapter({ gate: 1 });
		const view = mountHome(home.adapter);
		await flushRyotClient();
		const documents = () => home.requested.map((names) => [...names].sort());

		expect(documents()).toEqual([
			["library"],
			["flat.items", "podcast.items", "show.items"],
			["anime.anime", "shows.shows"],
			["flat.items", "podcast.items", "show.items"],
		]);
		expect(observers.map(({ rootMargin }) => rootMargin)).toEqual([
			"600px 0px",
			"600px 0px",
			"600px 0px",
		]);

		act(() => {
			for (const observer of observers) {
				observer.intersect();
			}
		});
		await flushRyotClient();

		expect(documents().slice(4)).toEqual([
			["suggestions.items", "suggestions.source"],
			["trending.trending"],
		]);
		view.unmount();
	});
	it("refreshes every section at local midnight", async () => {
		const home = homeAdapter({ gate: 1 });
		const view = mountRyotClient(home.adapter, null);
		await view.setTime(new Date(2026, 8, 25, 23, 30).getTime());
		view.rerender(<HomeBody compact scrollRootRef={{ current: null }} />);
		await flushRyotClient();
		const continueRequests = () =>
			home.requested.filter((names) => names.includes("flat.items") && names.includes("show.items"))
				.length;
		const beforeMidnight = continueRequests();

		await view.advance("31 minutes");
		await flushRyotClient();

		expect(continueRequests()).toBeGreaterThan(beforeMidnight);
		view.unmount();
	});
});

describe("first run", () => {
	it("links to the import page and opens provider search for the chosen type", async () => {
		const home = homeAdapter({ gate: 0 });
		const view = mountHome(home.adapter);
		await waitFor(() => expect(view.container.textContent).toContain("Start your media library"));

		clickRyotElement(getByRole(view.container, "link", { name: "Import your history" }));
		expect(home.navigations).toEqual([{ kind: "kernel-page", page: "import-data" }]);

		clickRyotElement(getByRole(view.container, "button", { name: "Add a title" }));
		clickRyotElement(getByRole(document.body, "menuitem", { name: "Comic book" }));
		expect(home.providerSearches).toEqual([
			{ ownerPluginId: "media", entitySchemaSlug: "comic-book" },
		]);
		expect(document.body.querySelector('[role="menu"]')).toBeNull();
		view.unmount();
	});
});
