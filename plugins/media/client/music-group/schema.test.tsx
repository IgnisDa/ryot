import { getByRole } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import { musicGroupRecipes } from "../../shared/music-group-recipes";
import {
	decodeCreditGroupOverviewOf,
	decodeGroupSummaryOf,
	groupSummaryRow,
} from "../../tests/client/group/fixtures";
import { readyQueryResult } from "../../tests/client/query-result-fixture";
import { clickRyotElement, mountRyotClient } from "../../tests/client/test-support";
import { mapMediaOverview } from "../media/overview-state";
import { musicGroupSchema } from "./schema";

const noopAdapter = { query: () => Promise.resolve({}) };

afterEach(() => {
	document.body.innerHTML = "";
});

describe("music group schema", () => {
	it("lists tracks, titles the credits as artists and labels, and draws square art", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<musicGroupSchema.ScreenBody
				compact
				members={null}
				safeAreaTop={0}
				activity={null}
				settled={undefined}
				refresh={() => undefined}
				refreshOverview={() => undefined}
				state={{ status: "ready", summary: decodeGroupSummaryOf(musicGroupRecipes) }}
				overview={mapMediaOverview(
					readyQueryResult(decodeCreditGroupOverviewOf(musicGroupRecipes)),
				)}
			/>,
		);

		expect(getByRole(container, "tab", { name: "Tracks" }).getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(container.textContent).toContain("Album");
		expect(container.textContent).toContain("2 of 5 listened");
		expect(
			container.querySelector(`img[src="${groupSummaryRow.memberImages[0]?.url}"]`)?.className,
		).toContain("aspect-square");
		clickRyotElement(getByRole(container, "tab", { name: "Overview" }));
		expect(container.textContent).toContain("Artists");
		expect(container.textContent).toContain("Labels");
		unmount();
	});
});
