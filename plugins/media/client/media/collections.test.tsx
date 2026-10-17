import { expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { getByRole, queryByRole, waitFor } from "@testing-library/dom";
import { Deferred } from "effect";

import { clickRyotElement, mountRyotClient } from "../../tests/client/test-support";
import { MediaCollectionsControl } from "./collections";

for (const kind of ["saved", "removed", "cancelled"] as const) {
	it.live(`opens the collection manager and refreshes the summary after ${kind}`, () =>
		Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			const requests: unknown[] = [];
			let added = true;
			const query = createRyotQuery(() =>
				Effect.sync(() => ({
					pageInfo: { hasMore: false },
					items: added ? [{ id: "collection-1" }] : [],
				})),
			);
			function View() {
				const result = useRyotQuery(query);
				return result.data === undefined ? null : (
					<MediaCollectionsControl entityId="media-1" collections={result.data} />
				);
			}
			const mounted = mountRyotClient(
				{
					addToCollection: (request) =>
						Effect.gen(function* () {
							requests.push(request);
							yield* Deferred.await(release);
							added = false;
							return { kind };
						}),
				},
				<View />,
			);
			try {
				yield* Effect.promise(() => mounted.advance(0));
				const button = getByRole(mounted.container, "button", { name: "1 collection" });
				clickRyotElement(button);
				yield* Effect.promise(() =>
					waitFor(() => expect(button.hasAttribute("disabled")).toBe(true)),
				);
				clickRyotElement(button);
				expect(requests).toEqual([{ entityId: "media-1" }]);
				yield* Deferred.succeed(release, undefined);
				yield* Effect.promise(() =>
					waitFor(() => expect(button.hasAttribute("disabled")).toBe(false)),
				);
				yield* Effect.promise(() => mounted.advance(250));
				expect(button.textContent).toBe(kind === "cancelled" ? "1 collection" : "Add to collection");
			} finally {
				mounted.unmount();
			}
		}),
	);
}

it.live("keeps the collection count on failure and allows retry", () =>
	Effect.gen(function* () {
		let attempts = 0;
		const mounted = mountRyotClient(
			{
				addToCollection: () =>
					Effect.suspend(() => {
						attempts++;
						return attempts === 1
							? Effect.fail(new RyotClientError("transport"))
							: Effect.succeed({ kind: "cancelled" });
					}),
			},
			<MediaCollectionsControl
				entityId="media-1"
				collections={{ items: [], pageInfo: { hasMore: false } }}
			/>,
		);
		try {
			const button = getByRole(mounted.container, "button", { name: "Add to collection" });
			clickRyotElement(button);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(getByRole(mounted.container, "alert").textContent).toBe(
						"Unable to open collections. Try again.",
					),
				),
			);
			expect(button.hasAttribute("disabled")).toBe(false);
			clickRyotElement(button);
			yield* Effect.promise(() =>
				waitFor(() => expect(queryByRole(mounted.container, "alert")).toBeNull()),
			);
			expect(attempts).toBe(2);
			expect(button.getAttribute("aria-pressed")).toBe("false");
		} finally {
			mounted.unmount();
		}
	}),
);
