import type { EntityInterest, RyotClientAdapter } from "@ryot-app/client-sdk";
import { Result } from "@ryot-app/client-sdk/effect";
import { ManagedAssetProvider, useRyotQuery, type RyotQuery } from "@ryot-app/client-sdk/react";
import { fireEvent, waitFor } from "@testing-library/dom";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
	decodeFlatActivity,
	emptyFlatActivity,
	flatCollectionAddedEventRow,
	flatProgressEventRow,
	repeatedFlatActivity,
} from "../../tests/client/flat-media/activity-fixture";
import {
	decodeFlatOverview,
	FLAT_OVERVIEW_INPUT,
	fixtureOverviewRecipe,
	flatCompanyRow,
	flatGroupMemberRow,
	flatGroupRow,
	flatOverviewData,
	flatPersonRow,
	flatRecommendationRow,
} from "../../tests/client/flat-media/overview-fixture";
import {
	flatFixtureRecipes,
	flatUngroupedFixtureRecipes,
} from "../../tests/client/flat-media/recipes";
import {
	fixtureSchema,
	ungroupedFixtureSchema,
} from "../../tests/client/flat-media/schema-fixture";
import {
	decodeFlatSummaryResult,
	fixtureSummaryRecipe,
	FLAT_SUMMARY_INPUT,
	flatSummaryRow,
} from "../../tests/client/flat-media/summary-fixture";
import {
	malformedQueryResult,
	pendingQueryResult,
	readyQueryResult,
	rowsResult,
	transportErrorQueryResult,
} from "../../tests/client/query-result-fixture";
import { flushRyotClient, mountRyotClient } from "../../tests/client/test-support";
import { mapMediaOverview } from "./overview-state";
import { classifyRyotQueryResult } from "./query-state";

const noopAdapter = { query: () => Promise.resolve({}) };

const resolvingAdapter: Partial<RyotClientAdapter> = {
	query: () => Promise.resolve({}),
	resolveAssets: (assets) =>
		Promise.resolve(
			assets.map((asset) => ({
				asset,
				url: `https://cdn.test/${asset.type}-${asset.key}`,
				expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
			})),
		),
};

const UNLINKED_CREATORS = [
	{ role: "Author", name: "Ann Author" },
	{ name: "Pan Press", role: "Publisher" },
];

const overviewOf = (input: Parameters<typeof decodeFlatOverview>[1] = {}) =>
	decodeFlatOverview(fixtureOverviewRecipe, input);

const readyState = (overrides: Record<string, unknown> = {}) =>
	fixtureSchema.mapSummary(
		readyQueryResult(
			decodeFlatSummaryResult(fixtureSummaryRecipe, {
				requested: [{ schemaSlug: "fixture" }],
				summary: [{ ...flatSummaryRow, ...overrides }],
			}),
		),
	);

type SummaryState = ReturnType<typeof readyState>;

const ungroupedReadyState = () =>
	ungroupedFixtureSchema.mapSummary(
		readyQueryResult(
			decodeFlatSummaryResult(flatUngroupedFixtureRecipes.summaryRecipe(FLAT_SUMMARY_INPUT), {
				requested: [{ schemaSlug: "ungrouped" }],
				summary: [{ ...flatSummaryRow, schemaSlug: "ungrouped" }],
			}),
		),
	);

const renderBody = (
	state: SummaryState,
	options: {
		readonly refresh?: () => void;
		readonly overview?: ReturnType<typeof overviewOf>;
	} = {},
) =>
	mountRyotClient(
		noopAdapter,
		<fixtureSchema.ScreenBody
			compact
			state={state}
			safeAreaTop={0}
			settled={undefined}
			refreshOverview={() => undefined}
			refresh={options.refresh ?? (() => undefined)}
			overview={mapMediaOverview(readyQueryResult(options.overview ?? overviewOf()))}
			activity={
				<fixtureSchema.Activity
					compact
					refresh={() => undefined}
					state={fixtureSchema.mapActivity(readyQueryResult(decodeFlatActivity()))}
				/>
			}
		/>,
	);

const renderActivity = (state: Parameters<typeof fixtureSchema.Activity>[0]["state"]) =>
	mountRyotClient(
		noopAdapter,
		<fixtureSchema.Activity compact state={state} refresh={() => undefined} />,
	);

const presentationData = (overrides: Record<string, unknown> = {}) => {
	const decoded = flatFixtureRecipes
		.presentationRecipe(["media-1"])
		.decode({
			data: {
				rows: rowsResult(
					[
						{
							id: "media-1",
							publishDate: null,
							publishYear: 1999,
							name: "Fight Club",
							progressPercent: 42,
							state: "in_progress",
							schemaSlug: "fixture",
							populationStatus: "ready",
							translationStatus: "none",
							productionStatus: "Released",
							images: [{ type: "remote", purpose: "cover", url: "https://images.test/fc.jpg" }],
							...overrides,
						},
					],
					{ limit: 100, hasMore: false, nextCursor: null },
				),
			},
		});
	if (decoded._tag === "Failure" || decoded.success[0] === undefined) {
		throw new Error("Expected decoded presentation data");
	}
	return { ...decoded.success[0], batchAssets: [] };
};

const tab = (container: HTMLElement, label: string) => {
	const found = Array.from(container.querySelectorAll('[role="tab"]')).find(
		(element) => element.textContent === label,
	);
	if (found === undefined) {
		throw new Error(`Expected a ${label} tab`);
	}
	return found;
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("flat media detail screen", () => {
	it("offers exactly the overview and activity tabs", () => {
		const { unmount, container } = renderBody(readyState());

		expect(
			Array.from(container.querySelectorAll('[role="tab"]')).map(({ textContent }) => textContent),
		).toEqual(["Overview", "Activity"]);
		unmount();
	});

	it("names the type, provider, release year and genres in the identity line", () => {
		const { unmount, container } = renderBody(readyState());

		expect(container.textContent).toContain("Fixture");
		expect(container.textContent).toContain("TMDB");
		expect(container.textContent).toContain("1999");
		expect(container.textContent).toContain("Drama");
		unmount();
	});

	it("shows the flat lifecycle label on the status rail", () => {
		const { unmount, container } = renderBody(readyState());

		expect(container.textContent).toContain("Your status");
		expect(container.textContent).toContain("Complete");
		unmount();
	});

	it("labels every flat lifecycle state", () => {
		expect(
			(["untracked", "backlog", "in_progress", "on_hold", "dropped", "complete"] as const).map(
				(state) => fixtureSchema.lifecycleLabel({ state }),
			),
		).toEqual(["Not tracked", "In backlog", "In progress", "On hold", "Dropped", "Complete"]);
	});

	it("renders the status rail progress bar only while the item is in progress", () => {
		const complete = renderBody(readyState({ progressPercent: 40 }));
		expect(complete.container.querySelector(".bg-success.rounded-pill")).toBeNull();
		complete.unmount();

		const unknown = renderBody(readyState({ state: "in_progress", progressPercent: null }));
		expect(unknown.container.querySelector(".bg-success.rounded-pill")).toBeNull();
		unknown.unmount();

		const inProgress = renderBody(readyState({ progressPercent: 40, state: "in_progress" }));
		const bar = inProgress.container.querySelector<HTMLElement>(".bg-success.rounded-pill");
		expect(bar?.style.width).toBe("40%");
		inProgress.unmount();
	});

	it("switches to the activity tab on demand", async () => {
		const { unmount, container } = renderBody(readyState());

		const selected = tab(container, "Activity");
		fireEvent.click(selected);

		await waitFor(() => expect(selected.getAttribute("aria-selected")).toBe("true"));
		expect(container.querySelector('[aria-label="Item record"]')).not.toBeNull();
		expect(container.textContent).toContain(`${flatProgressEventRow.progressPercent}% through`);
		expect(container.textContent).not.toContain("People");
		unmount();
	});

	it("explains that only this schema opens here when the entity is another schema", () => {
		const state = fixtureSchema.mapSummary(
			readyQueryResult(
				decodeFlatSummaryResult(fixtureSummaryRecipe, {
					summary: [],
					requested: [{ schemaSlug: "show" }],
				}),
			),
		);
		const { unmount, container } = renderBody(state);

		expect(container.textContent).toContain("Fixture unavailable");
		expect(container.textContent).toContain("This entity is not a item, and only items can be");
		unmount();
	});

	it("separates an absent entity from a transport failure", () => {
		expect(
			fixtureSchema.mapSummary(
				readyQueryResult(
					decodeFlatSummaryResult(fixtureSummaryRecipe, { summary: [], requested: [] }),
				),
			),
		).toEqual({ reason: "missing", status: "unavailable" });
		expect(fixtureSchema.mapSummary(transportErrorQueryResult()).status).toBe("transport-error");
	});

	it("waits on a pending summary and retries a malformed one", () => {
		const loading = renderBody(fixtureSchema.mapSummary(pendingQueryResult()));
		expect(loading.container.textContent).toContain("Loading item...");
		loading.unmount();

		let refreshCount = 0;
		const failed = renderBody(fixtureSchema.mapSummary(malformedQueryResult()), {
			refresh: () => {
				refreshCount += 1;
			},
		});
		expect(failed.container.textContent).toContain("Unable to display this item");
		const retry = Array.from(failed.container.querySelectorAll("button")).find(
			(button) => button.textContent === "Try again",
		);
		if (retry === undefined) {
			throw new Error("Expected the summary retry button");
		}
		fireEvent.click(retry);
		expect(refreshCount).toBe(1);
		failed.unmount();
	});

	it("titles the overview notice with the descriptor's credit copy while loading", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<fixtureSchema.ScreenBody
				compact
				safeAreaTop={0}
				activity={null}
				settled={undefined}
				state={readyState()}
				refresh={() => undefined}
				refreshOverview={() => undefined}
				overview={mapMediaOverview(pendingQueryResult())}
			/>,
		);

		expect(container.textContent).toContain("Credits");
		expect(container.textContent).toContain("Fetching the credits for this item.");
		unmount();
	});
});

describe("flat media overview", () => {
	it("renders the credits, recommendations and the group the item belongs to", () => {
		const { unmount, container } = renderBody(readyState());

		expect(container.textContent).toContain("People");
		expect(container.textContent).toContain("Companies");
		expect(container.textContent).toContain(flatPersonRow.name);
		expect(container.textContent).toContain(flatCompanyRow.name);
		expect(container.textContent).toContain(flatRecommendationRow.name);
		expect(container.textContent).toContain(`Part of ${flatGroupRow.name}`);
		expect(container.textContent).toContain("View group");
		expect(container.querySelector(`a[href="/e/${flatGroupRow.id}"]`)).not.toBeNull();
		expect(container.querySelector(`a[href="/e/${flatGroupMemberRow.id}"]`)).not.toBeNull();
		unmount();
	});

	it("keeps the group section for an item with no credits or recommendations", () => {
		const overview = overviewOf({ people: [], companies: [], recommendations: [] });

		expect(fixtureSchema.overviewIsEmpty(overview)).toBe(false);
		const { unmount, container } = renderBody(readyState(), { overview });

		expect(container.textContent).toContain(`Part of ${flatGroupRow.name}`);
		expect(container.textContent).not.toContain("People");
		unmount();
	});

	it("hides the group section when the group has no other members or is absent", () => {
		const noMembers = renderBody(readyState(), { overview: overviewOf({ members: [] }) });
		expect(noMembers.container.textContent).not.toContain("Part of");
		noMembers.unmount();

		const noGroup = renderBody(readyState(), { overview: overviewOf({ group: [] }) });
		expect(noGroup.container.textContent).not.toContain("Part of");
		noGroup.unmount();
	});

	it("lists unlinked people in the people rail and unlinked publishers with the companies", () => {
		const overview = overviewOf({ unlinkedCreators: UNLINKED_CREATORS });
		const { unmount, container } = renderBody(readyState(), { overview });

		expect(container.textContent).toContain(flatPersonRow.name);
		expect(container.querySelector('[aria-label="Open Ann Author"]')).toBeNull();
		expect(container.querySelector('[aria-label="Open Pan Press"]')).toBeNull();
		const sections = Array.from(container.querySelectorAll("section"));
		expect(
			sections.find((section) => section.textContent.startsWith("People"))?.textContent,
		).toContain("Ann Author");
		expect(
			sections.find((section) => section.textContent.startsWith("Companies"))?.textContent,
		).toContain("Pan Press");
		unmount();
	});

	it("keeps an overview holding only unlinked creators", () => {
		const bare = { group: [], people: [], companies: [], recommendations: [] };
		const onlyUnlinked = overviewOf({ ...bare, unlinkedCreators: UNLINKED_CREATORS });

		expect(fixtureSchema.overviewIsEmpty(onlyUnlinked)).toBe(false);
		expect(fixtureSchema.overviewIsEmpty(overviewOf(bare))).toBe(true);
		const { unmount, container } = renderBody(readyState(), { overview: onlyUnlinked });
		expect(container.textContent).toContain("Ann Author");
		unmount();
	});

	it("reports an overview with neither relations nor group members as empty", () => {
		expect(
			fixtureSchema.overviewIsEmpty(
				overviewOf({ people: [], members: [], companies: [], recommendations: [] }),
			),
		).toBe(true);
		expect(fixtureSchema.overviewIsEmpty(overviewOf())).toBe(false);
	});

	it("never builds a part-of section for a descriptor that declares no group", () => {
		const overview = Result.getOrThrow(
			flatUngroupedFixtureRecipes
				.overviewRecipe(FLAT_OVERVIEW_INPUT)
				.decode({ data: flatOverviewData() }),
		);

		expect(ungroupedFixtureSchema.overviewIsEmpty(overview)).toBe(false);
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<ungroupedFixtureSchema.ScreenBody
				compact
				safeAreaTop={0}
				activity={null}
				settled={undefined}
				refresh={() => undefined}
				state={ungroupedReadyState()}
				refreshOverview={() => undefined}
				overview={mapMediaOverview(readyQueryResult(overview))}
			/>,
		);

		expect(container.textContent).toContain("People");
		expect(container.textContent).not.toContain("Part of");
		unmount();
	});

	it("resolves the group members' covers alongside the credit and recommendation art", () => {
		const overview = overviewOf({
			companies: [],
			recommendations: [],
			people: [{ ...flatPersonRow, images: [{ type: "s3", key: "person", purpose: "profile" }] }],
		});

		expect(fixtureSchema.overviewManagedAssets(overview)).toEqual([
			{ type: "s3", key: "fc2-cover" },
			{ type: "s3", key: "person" },
		]);
	});

	it("resolves the group tiles through the overview's managed asset provider", async () => {
		const overview = overviewOf();
		const { unmount, container } = mountRyotClient(
			resolvingAdapter,
			<ManagedAssetProvider assets={fixtureSchema.overviewManagedAssets(overview)}>
				<fixtureSchema.ScreenBody
					compact
					safeAreaTop={0}
					activity={null}
					settled={undefined}
					state={readyState()}
					refresh={() => undefined}
					refreshOverview={() => undefined}
					overview={mapMediaOverview(readyQueryResult(overview))}
				/>
			</ManagedAssetProvider>,
		);

		const tile = () =>
			container.querySelector(`a[href="/e/${flatGroupMemberRow.id}"] img`)?.getAttribute("src");

		await waitFor(() => expect(tile()).toBe("https://cdn.test/s3-fc2-cover"));
		unmount();
	});
});

describe("flat media activity tab", () => {
	it("summarises completions, the measure and the span", () => {
		const { unmount, container } = renderActivity(
			fixtureSchema.mapActivity(readyQueryResult(decodeFlatActivity())),
		);

		expect(container.textContent).toContain("Passes");
		expect(container.textContent).toContain("Time");
		expect(container.textContent).toContain("2h 49m");
		expect(container.textContent).toContain("Span");
		unmount();
	});

	it("renders one segment per completion with the descriptor's segment noun", () => {
		const { unmount, container } = renderActivity(
			fixtureSchema.mapActivity(readyQueryResult(repeatedFlatActivity())),
		);

		expect(container.textContent).toContain("Pass 2 ·");
		expect(container.textContent).toContain("Pass 1 ·");
		expect(container.textContent).toContain("Finished the item");
		unmount();
	});

	it("invites a first log when nothing was ever recorded", () => {
		const { unmount, container } = renderActivity(
			fixtureSchema.mapActivity(readyQueryResult(emptyFlatActivity())),
		);

		expect(container.textContent).toContain("No activity yet");
		expect(container.textContent).toContain("Nothing has been recorded for this item.");
		unmount();
	});

	it("separates transport failures from malformed activity", () => {
		const transport = renderActivity(fixtureSchema.mapActivity(transportErrorQueryResult()));
		expect(transport.container.textContent).toContain("Unable to load activity");
		transport.unmount();

		const malformed = renderActivity(fixtureSchema.mapActivity(malformedQueryResult()));
		expect(malformed.container.textContent).toContain("could not be displayed");
		malformed.unmount();
	});
});

describe("flat media entity presentations", () => {
	it("shows the year and lifecycle state on the row", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<fixtureSchema.RowContent compact entityId="media-1" data={presentationData()} />,
		);

		expect(container.textContent).toContain("1999");
		expect(container.textContent).toContain("In progress");
		unmount();
	});

	it("hints at recorded progress only while the item is in progress", () => {
		const inProgress = mountRyotClient(
			noopAdapter,
			<fixtureSchema.CardContent compact entityId="media-1" data={presentationData()} />,
		);
		expect(inProgress.container.textContent).toContain("42% done");
		inProgress.unmount();

		const complete = mountRyotClient(
			noopAdapter,
			<fixtureSchema.CardContent
				compact
				entityId="media-1"
				data={presentationData({ state: "complete" })}
			/>,
		);
		expect(complete.container.textContent).not.toContain("42% done");
		expect(complete.container.textContent).toContain("Complete");
		complete.unmount();
	});
});

const recordingAdapter = () => {
	const interests: EntityInterest[] = [];
	const requests: Array<{ resolve: (data: unknown) => void }> = [];
	const adapter: Partial<RyotClientAdapter> = {
		query: () => new Promise((resolve) => requests.push({ resolve })),
		watchEntities: (interest) => {
			interests.push(interest);
			return { dispose: () => undefined, update: (next) => interests.push(next) };
		},
	};
	return { adapter, requests, interests };
};

const rows = (items: readonly unknown[]) =>
	rowsResult(items, { limit: 100, hasMore: false, nextCursor: null });

const declaresInterest = <Data,>(
	name: string,
	query: RyotQuery<{ readonly entityId: string }, Data>,
	response: unknown,
	visible: readonly string[],
) => {
	it(`${name} watches every entity it renders`, async () => {
		const recording = recordingAdapter();
		function Probe() {
			return <p>{classifyRyotQueryResult(useRyotQuery(query, { entityId: "media-1" })).status}</p>;
		}
		const view = mountRyotClient(recording.adapter, <Probe />);
		await flushRyotClient();
		await act(async () => {
			recording.requests[0]?.resolve(response);
			await Promise.resolve();
		});
		await waitFor(() => expect(view.container.textContent).toContain("ready"));

		expect(recording.interests.at(-1)).toEqual({
			foreground: ["media-1"],
			visible: [...visible].sort(),
		});
		view.unmount();
	});
};

describe("flat media query entity interest", () => {
	declaresInterest(
		"summary",
		fixtureSchema.summaryQuery,
		{ data: { summary: rows([flatSummaryRow]), requested: rows([{ schemaSlug: "fixture" }]) } },
		["collection-1"],
	);
	declaresInterest("overview", fixtureSchema.overviewQuery, { data: flatOverviewData() }, [
		"person-1",
		"company-1",
		"media-2",
		"media-3",
	]);
	declaresInterest(
		"activity",
		fixtureSchema.activityQuery,
		{
			data: {
				events: rows([flatProgressEventRow]),
				collectionEvents: rows([flatCollectionAddedEventRow]),
				totals: rows([{ completionCount: 1, consumedAmount: 169, unknownAmountCount: 0 }]),
			},
		},
		["collection-1"],
	);
});
