import { afterEach, describe, expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { getAllByRole, getByRole, queryByRole, waitFor } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";

import { rowsResult } from "../../../tests/client/query-result-fixture";
import {
	clickRyotElement,
	flushRyotClient,
	mountRyotClient,
} from "../../../tests/client/test-support";
import { ActivitySeasonSelector } from "./sheet";

afterEach(() => {
	document.body.innerHTML = "";
});

describe("activity season choices", () => {
	it.live(
		"pages beyond one hundred seasons and makes the final season selectable",
		() =>
			Effect.gen(function* () {
				const documents: string[] = [];
				const selected: number[] = [];
				const view = mountRyotClient(
					{
						query: (document) => {
							const serialized = JSON.stringify(document);
							documents.push(serialized);
							const index = Number(/"after":"seasons-(\d+)"/.exec(serialized)?.[1] ?? 0);
							return Effect.succeed({
								data: {
									seasons: rowsResult(
										Array.from({ length: Math.min(40, 125 - index * 40) }, (_, offset) => ({
											seasonNumber: index * 40 + offset + 1,
											id: `season-${index * 40 + offset + 1}`,
											name: `Season ${index * 40 + offset + 1}`,
										})),
										{
											limit: 40,
											hasMore: index < 3,
											nextCursor: index < 3 ? `seasons-${index + 1}` : null,
										},
									),
								},
							});
						},
					},
					<ActivitySeasonSelector
						seasonNumber={1}
						entityId="show-1"
						onSeason={(number) => selected.push(number)}
					/>,
				);
				yield* Effect.promise(() => flushRyotClient());
				for (const count of [2, 3, 4]) {
					clickRyotElement(getByRole(view.container, "button", { name: "Load more seasons" }));
					yield* Effect.promise(() => flushRyotClient());
					yield* Effect.promise(() => waitFor(() => expect(documents).toHaveLength(count)));
				}
				expect(queryByRole(view.container, "button", { name: "Load more seasons" })).toBeNull();
				clickRyotElement(getByRole(view.container, "button", { name: /^Season:/ }));
				yield* Effect.promise(() => flushRyotClient());
				const picker = getByRole(document.body, "dialog", { name: "Season" });
				expect(getAllByRole(picker, "radio")).toHaveLength(125);
				clickRyotElement(getByRole(picker, "radio", { name: "Season 125" }));
				yield* Effect.promise(() => flushRyotClient());
				expect(selected).toEqual([125]);
				expect(documents.every((document) => document.includes('"limit":40'))).toBe(true);
				view.unmount();
			}),
		testTimeout,
	);
});
