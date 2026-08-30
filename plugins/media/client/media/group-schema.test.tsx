import type { RyotClientAdapter } from "@ryot-app/client-sdk";
import { getByRole, waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import {
	decodeCreditGroupOverview,
	decodeGroupActivity,
	decodeGroupSummary,
	groupMemberPageData,
	groupMemberRow,
} from "../../tests/client/group/fixtures";
import {
	creditGroupFixtureSchema,
	groupFixtureSchema,
} from "../../tests/client/group/schema-fixture";
import { readyQueryResult } from "../../tests/client/query-result-fixture";
import {
	clickRyotElement,
	flushRyotClient,
	mountRyotClient,
} from "../../tests/client/test-support";
import { mapMediaOverview } from "./overview-state";

const noopAdapter = { query: () => Promise.resolve({}) };

const renderBody = (summary = decodeGroupSummary()) =>
	mountRyotClient(
		noopAdapter,
		<groupFixtureSchema.ScreenBody
			compact
			safeAreaTop={0}
			activity={null}
			settled={undefined}
			refresh={() => undefined}
			members={<p>Member rows</p>}
			refreshOverview={() => undefined}
			state={{ summary, status: "ready" }}
			overview={mapMediaOverview(readyQueryResult({}))}
		/>,
	);

const selectTab = (container: HTMLElement, name: string) =>
	clickRyotElement(getByRole(container, "tab", { name }));

const loadMore = (container: HTMLElement) =>
	Array.from(container.querySelectorAll("button")).find(
		(button) => button.textContent === "Load more",
	);

const pagingAdapter = () => {
	const documents: unknown[] = [];
	const adapter: Partial<RyotClientAdapter> = {
		watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
		query: (document) => {
			documents.push(document);
			return Promise.resolve(
				JSON.stringify(document).includes("cursor-1")
					? groupMemberPageData({
							members: [groupMemberRow({ position: 3, id: "member-3", name: "Revolutions" })],
						})
					: groupMemberPageData({
							nextCursor: "cursor-1",
							members: [
								groupMemberRow({ position: 1, id: "member-1", name: "The Matrix" }),
								groupMemberRow({ position: null, id: "member-2", name: "Reloaded" }),
							],
						}),
			);
		},
	};
	return { adapter, documents };
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("group detail screen", () => {
	it("opens on the members tab ahead of the overview and activity", () => {
		const { unmount, container } = renderBody();

		expect(
			Array.from(container.querySelectorAll('[role="tab"]')).map(({ textContent }) => textContent),
		).toEqual(["Items", "Overview", "Activity"]);
		expect(getByRole(container, "tab", { name: "Items" }).getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(container.textContent).toContain("Member rows");
		unmount();
	});

	it("reports completed members on the rail and the parts as a fact", () => {
		const { unmount, container } = renderBody();

		expect(container.textContent).toContain("Your status");
		expect(container.textContent).toContain("2 of 5 done");
		expect(container.querySelector('[style="width: 40%;"]')).not.toBeNull();
		expect(container.textContent).toContain("5items");
		unmount();
	});

	it("hides the status row when the group has no members", () => {
		const { unmount, container } = renderBody(
			decodeGroupSummary({ memberCount: 0, completedMemberCount: 0 }),
		);

		expect(container.textContent).not.toContain("Your status");
		unmount();
	});

	it("draws the first member's cover when the group has no images of its own", () => {
		const { unmount, container } = renderBody();

		expect(container.querySelector('img[src="https://images.test/matrix.jpg"]')).not.toBeNull();
		unmount();
	});

	it("explains an overview with neither images nor credits", () => {
		const { unmount, container } = renderBody(decodeGroupSummary({ memberImages: null }));
		selectTab(container, "Overview");

		expect(container.textContent).toContain("Nothing more to show");
		expect(container.textContent).toContain("This group has no images or credits yet.");
		unmount();
	});

	it("issues no overview query without credits and renders the credit columns with them", () => {
		expect(groupFixtureSchema.overviewQuery).toBeUndefined();
		expect(creditGroupFixtureSchema.overviewQuery).not.toBeUndefined();

		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<creditGroupFixtureSchema.ScreenBody
				compact
				members={null}
				safeAreaTop={0}
				activity={null}
				settled={undefined}
				refresh={() => undefined}
				refreshOverview={() => undefined}
				state={{ status: "ready", summary: decodeGroupSummary() }}
				overview={mapMediaOverview(readyQueryResult(decodeCreditGroupOverview()))}
			/>,
		);
		selectTab(container, "Overview");

		expect(container.textContent).toContain("Artists");
		expect(container.textContent).toContain("Nina Simone");
		expect(container.textContent).not.toContain("Nothing more to show");
		unmount();
	});
});

describe("group members tab", () => {
	it("numbers each member by its position in the group", async () => {
		const { adapter } = pagingAdapter();
		const view = mountRyotClient(
			adapter,
			<groupFixtureSchema.MembersTab compact entityId="group-1" />,
		);
		await flushRyotClient();
		await waitFor(() => expect(view.container.textContent).toContain("The Matrix"));

		const articles = Array.from(view.container.querySelectorAll("article"));
		expect(
			articles.map((article) => article.querySelector(":scope > span")?.textContent ?? null),
		).toEqual(["1", null]);
		view.unmount();
	});

	it("appends the next page without refetching the page already on screen", async () => {
		const { adapter, documents } = pagingAdapter();
		const view = mountRyotClient(
			adapter,
			<groupFixtureSchema.MembersTab compact entityId="group-1" />,
		);
		await flushRyotClient();
		await waitFor(() => expect(view.container.textContent).toContain("The Matrix"));

		const control = loadMore(view.container);
		if (control === undefined) {
			throw new Error("Expected the load more control");
		}
		clickRyotElement(control);
		await flushRyotClient();

		await waitFor(() => expect(view.container.textContent).toContain("Revolutions"));
		expect(view.container.textContent).toContain("The Matrix");
		expect(documents).toHaveLength(2);
		expect(loadMore(view.container)).toBeUndefined();
		view.unmount();
	});
});

const renderActivity = (state: Parameters<typeof groupFixtureSchema.Activity>[0]["state"]) =>
	mountRyotClient(
		noopAdapter,
		<groupFixtureSchema.Activity compact state={state} refresh={() => undefined} />,
	);

describe("group activity tab", () => {
	it("lists the group's reviews", () => {
		const { unmount, container } = renderActivity(
			groupFixtureSchema.mapActivity(readyQueryResult(decodeGroupActivity())),
		);

		expect(container.textContent).toContain("Reviews");
		expect(container.textContent).toContain("Reviewed this group");
		unmount();
	});

	it("invites a review when nothing was recorded", () => {
		const { unmount, container } = renderActivity(
			groupFixtureSchema.mapActivity(
				readyQueryResult(decodeGroupActivity({ events: [], reviewCount: 0, collectionEvents: [] })),
			),
		);

		expect(container.textContent).toContain("No activity yet");
		expect(container.textContent).toContain("Write review");
		unmount();
	});
});
