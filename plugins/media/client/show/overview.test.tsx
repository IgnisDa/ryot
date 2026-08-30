// @vitest-environment jsdom

import { fireEvent, waitFor } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import { ShowOverview } from "./overview";
import {
	decodeShowOverview,
	emptyShowOverview,
	showCompanyRow,
	showPersonRow,
	showRecommendationRow,
} from "./overview-fixture";
import { decodeShowSummary } from "./summary-fixture";
import { mountRyotClient } from "./test-support";

const noopAdapter = { query: () => Promise.resolve({}) };

const readyOverview = decodeShowOverview();

afterEach(() => {
	document.body.innerHTML = "";
});

describe("ShowOverview", () => {
	it("renders the gallery, cast, companies and recommendations from a ready overview", () => {
		const { container, unmount } = mountRyotClient(
			noopAdapter,
			<ShowOverview
				compact
				overview={{ status: "ready", overview: readyOverview }}
				show={decodeShowSummary()}
				refreshOverview={() => undefined}
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
		const { container, unmount } = mountRyotClient(
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

	it("shows a loading notice while the overview is loading", () => {
		const { container, unmount } = mountRyotClient(
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
		const { container, unmount } = mountRyotClient(
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
