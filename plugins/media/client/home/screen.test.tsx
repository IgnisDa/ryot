import { afterEach, describe, expect, it } from "@effect/vitest";
import {
	type RyotClientAdapter,
	RyotClientError,
	type RyotNavigationTarget,
} from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import { usePageRefreshRequest } from "@ryot-app/plugin-client-sdk/react";
import { getByRole, waitFor } from "@testing-library/dom";
import { act } from "react";

import { flatRow, mediaIdentity, rows } from "../../tests/client/home/fixtures";
import {
	clickRyotElement,
	flushRyotClient,
	localDateTime,
	mountRyotClient,
} from "../../tests/client/test-support";
import { HomeBody } from "./screen";

const libraryCount = (count: number) => ({ type: "aggregate", items: [{ count }] });

const inProgressMovie = flatRow("movie-1", "Heat", "movie", {
	progressPercent: 40,
	latestActivityAt: "2026-09-24T10:00:00.000Z",
});

type Responses = Readonly<Record<string, unknown>>;

const homeAdapter = (input: {
	readonly responses?: Responses;
	readonly gate: number | "error" | "pending";
}) => {
	const requested: string[][] = [];
	const navigations: RyotNavigationTarget[] = [];
	const entityPicks: unknown[] = [];
	let gate = input.gate;
	const adapter = {
		navigate: (_mode, target) => {
			navigations.push(target);
		},
		watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
		pickEntity: (request) =>
			Effect.sync(() => entityPicks.push(request)).pipe(Effect.as({ kind: "cancelled" as const })),
		query: (document) => {
			const names = Object.keys(document.queries);
			requested.push(names);
			if (names.includes("library")) {
				if (gate === "pending") {
					return Effect.never;
				}
				if (gate === "error") {
					return Effect.fail(new RyotClientError("transport"));
				}
				return Effect.succeed({ data: { library: libraryCount(gate) } });
			}
			return Effect.succeed({
				data: Object.fromEntries(names.map((name) => [name, input.responses?.[name] ?? rows([])])),
			});
		},
	} satisfies Partial<RyotClientAdapter>;
	return {
		adapter,
		requested,
		navigations,
		entityPicks,
		setGate: (next: typeof input.gate) => {
			gate = next;
		},
	};
};

function RefreshHome() {
	const refresh = usePageRefreshRequest();
	return <button onClick={refresh}>Refresh home</button>;
}

const mountHome = (adapter: Partial<RyotClientAdapter>) =>
	mountRyotClient(
		adapter,
		<>
			<RefreshHome />
			<HomeBody compact scrollRootRef={{ current: null }} />
		</>,
	);

const observers: RecordingIntersectionObserver[] = [];

class RecordingIntersectionObserver implements IntersectionObserver {
	readonly scrollMargin = "";
	readonly rootMargin: string;
	readonly targets = new Set<Element>();
	readonly root: null | Element | Document;
	readonly thresholds: readonly number[] = [];

	constructor(
		private readonly callback: IntersectionObserverCallback,
		options?: IntersectionObserverInit,
	) {
		this.root = options?.root ?? null;
		this.rootMargin = options?.rootMargin ?? "";
		observers.push(this);
	}

	takeRecords() {
		return [];
	}

	disconnect() {
		this.targets.clear();
	}

	observe(target: Element) {
		this.targets.add(target);
	}

	unobserve(target: Element) {
		this.targets.delete(target);
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
	it.live("shows a page skeleton while the library count is pending", () =>
		Effect.gen(function* () {
			const view = mountHome(homeAdapter({ gate: "pending" }).adapter);
			yield* Effect.promise(() => flushRyotClient());
			expect(view.container.querySelector('[aria-label="Loading your media"]')).not.toBeNull();
			view.unmount();
		}),
	);

	it.live("shows the first-run panel for an empty library", () =>
		Effect.gen(function* () {
			const view = mountHome(homeAdapter({ gate: 0 }).adapter);
			yield* Effect.promise(() =>
				waitFor(() => expect(view.container.textContent).toContain("Start your media library")),
			);
			view.unmount();
		}),
	);

	it.live("shows the rails for a library with media", () =>
		Effect.gen(function* () {
			const view = mountHome(
				homeAdapter({ gate: 1, responses: { "flat.items": rows([inProgressMovie]) } }).adapter,
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(view.container.textContent).toContain("Continue")),
			);
			expect(view.container.textContent).not.toContain("Start your media library");
			view.unmount();
		}),
	);

	it.live("fails open to the rails when the library count errors", () =>
		Effect.gen(function* () {
			const view = mountHome(
				homeAdapter({ gate: "error", responses: { "flat.items": rows([inProgressMovie]) } })
					.adapter,
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(view.container.textContent).toContain("Heat")),
			);
			expect(view.container.textContent).not.toContain("Start your media library");
			view.unmount();
		}),
	);

	for (const gate of [1, "error"] as const) {
		it.live(
			`keeps discovery and activity available with empty eager subsets and count ${gate}`,
			() =>
				Effect.gen(function* () {
					globalThis.IntersectionObserver = RecordingIntersectionObserver;
					const home = homeAdapter({
						gate,
						responses: {
							days: { items: [], type: "aggregate" },
							mediaTypes: { items: [], type: "aggregate" },
							figures: { type: "aggregate", items: [{ reviews: 0, finished: 1, minutes: 116 }] },
							"trending.trending": rows([
								{
									...mediaIdentity("arrival", "Arrival", "movie"),
									rank: 1,
									fetchedAt: "2026-09-24T10:00:00.000Z",
								},
							]),
						},
					});
					const view = mountHome(home.adapter);
					yield* Effect.promise(() => flushRyotClient());
					expect(observers).toHaveLength(3);
					expect(
						home.requested
							.filter((names) => !names.includes("library"))
							.map((names) => [...names].sort()),
					).toEqual([
						["flat.items", "podcast.items", "show.items"],
						["anime.anime", "shows.shows"],
						["flat.items", "podcast.items", "show.items"],
					]);
					expect(view.container.textContent).not.toContain("Start your media library");
					expect(view.container.textContent).not.toContain("Continue");
					expect(view.container.textContent).not.toContain("Airing");
					expect(view.container.textContent).not.toContain("Backlog");

					act(() => {
						for (const observer of observers) {
							observer.intersect();
						}
					});
					yield* Effect.promise(() =>
						waitFor(() => {
							expect(view.container.textContent).toContain("Arrival");
							expect(view.container.textContent).toContain("Your activity");
							expect(view.container.textContent).toContain("Finished");
						}),
					);
					expect(view.container.textContent).not.toContain("Start your media library");
					expect(view.container.querySelector('[role="alert"]')).toBeNull();
					view.unmount();
				}),
		);
	}

	it.live("shows first run after a failed count recovers to zero with empty eager subsets", () =>
		Effect.gen(function* () {
			globalThis.IntersectionObserver = RecordingIntersectionObserver;
			const home = homeAdapter({ gate: "error" });
			const view = mountHome(home.adapter);
			yield* Effect.promise(() => flushRyotClient());
			expect(observers).toHaveLength(3);
			expect(view.container.textContent).not.toContain("Start your media library");

			home.setGate(0);
			clickRyotElement(getByRole(view.container, "button", { name: "Refresh home" }));
			yield* Effect.promise(() => view.advance(250));
			yield* Effect.promise(() =>
				waitFor(() => expect(view.container.textContent).toContain("Start your media library")),
			);
			expect(observers.every(({ targets }) => targets.size === 0)).toBe(true);
			view.unmount();
		}),
	);

	it.live("keeps populated rails when a previously nonzero count fails to refresh", () =>
		Effect.gen(function* () {
			const home = homeAdapter({ gate: 1, responses: { "flat.items": rows([inProgressMovie]) } });
			const view = mountHome(home.adapter);
			yield* Effect.promise(() =>
				waitFor(() => expect(view.container.textContent).toContain("Heat")),
			);

			home.setGate("error");
			clickRyotElement(getByRole(view.container, "button", { name: "Refresh home" }));
			yield* Effect.promise(() => view.advance(250));
			yield* Effect.promise(() => flushRyotClient());
			expect(home.requested.filter((names) => names.includes("library"))).toHaveLength(2);
			expect(view.container.textContent).toContain("Heat");
			expect(view.container.textContent).not.toContain("Start your media library");
			expect(view.container.querySelector('[aria-label="Loading your media"]')).toBeNull();
			view.unmount();
		}),
	);

	it.live("keeps populated rails available when another eager rail fails", () =>
		Effect.gen(function* () {
			globalThis.IntersectionObserver = RecordingIntersectionObserver;
			const home = homeAdapter({ gate: 1, responses: { "flat.items": rows([inProgressMovie]) } });
			const view = mountHome({
				...home.adapter,
				query: (document) =>
					Object.hasOwn(document.queries, "anime.anime")
						? Effect.fail(new RyotClientError("transport"))
						: home.adapter.query(document),
			});
			yield* Effect.promise(() =>
				waitFor(() => {
					expect(view.container.textContent).toContain("Heat");
					expect(getByRole(view.container, "alert")).toBeDefined();
				}),
			);
			expect(view.container.textContent).not.toContain("Start your media library");
			view.unmount();
		}),
	);
});

describe("home sections", () => {
	it.live("runs eager sections as their own documents and mounts the rest near the viewport", () =>
		Effect.gen(function* () {
			globalThis.IntersectionObserver = RecordingIntersectionObserver;
			const home = homeAdapter({ gate: 1 });
			const view = mountHome(home.adapter);
			yield* Effect.promise(() => flushRyotClient());
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
			yield* Effect.promise(() => flushRyotClient());

			expect(documents().slice(4)).toEqual([
				["suggestions.items", "suggestions.source"],
				["trending.trending"],
				["days", "figures", "mediaTypes"],
				["days", "figures", "mediaTypes"],
			]);
			view.unmount();
		}),
	);
	it.live("refreshes every section at local midnight", () =>
		Effect.gen(function* () {
			const home = homeAdapter({ gate: 1 });
			const view = mountRyotClient(home.adapter, null);
			yield* Effect.promise(() =>
				view.setTime(
					DateTime.toEpochMillis(
						localDateTime({ day: 25, hour: 23, month: 9, minute: 30, year: 2026 }),
					),
				),
			);
			view.rerender(<HomeBody compact scrollRootRef={{ current: null }} />);
			yield* Effect.promise(() => flushRyotClient());
			const continueRequests = () =>
				home.requested.filter(
					(names) => names.includes("flat.items") && names.includes("show.items"),
				).length;
			const beforeMidnight = continueRequests();

			yield* Effect.promise(() => view.advance("31 minutes"));
			yield* Effect.promise(() => flushRyotClient());

			expect(continueRequests()).toBeGreaterThan(beforeMidnight);
			view.unmount();
		}),
	);
});

describe("first run", () => {
	it.live("links to the import page and opens provider search for the chosen type", () =>
		Effect.gen(function* () {
			const home = homeAdapter({ gate: 0 });
			const view = mountHome(home.adapter);
			yield* Effect.promise(() =>
				waitFor(() => expect(view.container.textContent).toContain("Start your media library")),
			);

			clickRyotElement(getByRole(view.container, "link", { name: "Import your history" }));
			expect(home.navigations).toEqual([{ kind: "kernel-page", page: "import-data" }]);

			clickRyotElement(getByRole(view.container, "button", { name: "Add a title" }));
			clickRyotElement(getByRole(document.body, "menuitem", { name: "Comic book" }));
			expect(home.entityPicks).toEqual([
				{
					schema: { slug: "comic-book", owner: { kind: "plugin", pluginId: "media-owner" } },
					library: { librarySchemaSlug: "media-library", relationshipSlug: "in-media-library" },
				},
			]);
			expect(document.body.querySelector('[role="menu"]')).toBeNull();
			view.unmount();
		}),
	);
});
