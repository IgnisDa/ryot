import { expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { getByRole, queryByRole, waitFor } from "@testing-library/dom";
import { Deferred } from "effect";

import {
	decodeFlatSummary,
	fixtureSummaryRecipe,
} from "../../tests/client/flat-media/summary-fixture";
import { clickRyotElement, mountRyotClient } from "../../tests/client/test-support";
import { MediaSummaryHeader } from "./summary-header";
import type { MediaEntitySummaryValue } from "./summary-state";

function Header(props: { readonly media: MediaEntitySummaryValue }) {
	return (
		<MediaSummaryHeader
			compact={false}
			media={props.media}
			settled={undefined}
			artwork={{ purpose: "cover", aspect: "poster" }}
			detail={{
				chips: [],
				facts: [],
				links: [],
				identityDetail: undefined,
				rail: { logActivity: false },
			}}
		/>
	);
}

it.live(
	"enables and disables monitoring, prevents duplicate writes, and refreshes library state",
	() =>
		Effect.gen(function* () {
			const release = yield* Deferred.make<void>();
			const requests: unknown[] = [];
			let monitored = false;
			let inLibrary = false;
			const query = createRyotQuery(() =>
				Effect.sync(() =>
					decodeFlatSummary(fixtureSummaryRecipe, {
						images: [],
						isMonitored: monitored,
						isInMediaLibrary: inLibrary,
					}),
				),
			);
			function View() {
				const result = useRyotQuery(query);
				return result.data === undefined ? null : <Header media={result.data} />;
			}
			const mounted = mountRyotClient(
				{
					invokeOperation: (request) =>
						Effect.gen(function* () {
							requests.push(request);
							yield* Deferred.await(release);
							monitored = request.slug === "media-monitoring-enable";
							inLibrary ||= monitored;
							return {
								results: [{ status: "found", entityId: "media-1", isMediaMonitored: monitored }],
							};
						}),
				},
				<View />,
			);
			try {
				yield* Effect.promise(() => mounted.advance(0));
				const control = getByRole(mounted.container, "switch", { name: "Toggle media monitoring" });
				expect(control.getAttribute("aria-checked")).toBe("false");
				clickRyotElement(control);
				yield* Effect.promise(() =>
					waitFor(() => expect(control.hasAttribute("disabled")).toBe(true)),
				);
				clickRyotElement(control);
				expect(requests).toEqual([
					{
						packageId: "ryot/media",
						slug: "media-monitoring-enable",
						input: { entityIds: ["media-1"] },
					},
				]);
				yield* Deferred.succeed(release, undefined);
				yield* Effect.promise(() =>
					waitFor(() => expect(control.hasAttribute("disabled")).toBe(false)),
				);
				yield* Effect.promise(() => mounted.advance(250));
				expect(control.getAttribute("aria-checked")).toBe("true");
				expect(mounted.container.querySelector(".bg-success")).not.toBeNull();
				clickRyotElement(control);
				yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(2)));
				expect(requests[1]).toEqual({
					packageId: "ryot/media",
					slug: "media-monitoring-disable",
					input: { entityIds: ["media-1"] },
				});
				yield* Effect.promise(() =>
					waitFor(() => expect(control.hasAttribute("disabled")).toBe(false)),
				);
				yield* Effect.promise(() => mounted.advance(250));
				expect(control.getAttribute("aria-checked")).toBe("false");
				expect(mounted.container.querySelector(".bg-success")).not.toBeNull();
			} finally {
				mounted.unmount();
			}
		}),
);

for (const failure of ["transport", "missing", "mismatched", "unchanged"] as const) {
	it.live(`keeps the current monitoring state and allows retry after a ${failure} result`, () =>
		Effect.gen(function* () {
			let attempts = 0;
			const mounted = mountRyotClient(
				{
					invokeOperation: () =>
						Effect.gen(function* () {
							attempts++;
							if (attempts === 1) {
								if (failure === "transport") {
									return yield* new RyotClientError("unsupported-capability");
								}
								return {
									results: [
										failure === "missing"
											? { status: "notFound", entityId: "media-1" }
											: {
													status: "found",
													isMediaMonitored: failure !== "unchanged",
													entityId: failure === "mismatched" ? "other" : "media-1",
												},
									],
								};
							}
							return {
								results: [{ status: "found", entityId: "media-1", isMediaMonitored: true }],
							};
						}),
				},
				<Header media={decodeFlatSummary(fixtureSummaryRecipe, { images: [] })} />,
			);
			try {
				const control = getByRole(mounted.container, "switch");
				clickRyotElement(control);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(getByRole(mounted.container, "alert").textContent).toBe(
							"Unable to change monitoring. Try again.",
						),
					),
				);
				expect(control.getAttribute("aria-checked")).toBe("false");
				expect(control.hasAttribute("disabled")).toBe(false);
				clickRyotElement(control);
				yield* Effect.promise(() => waitFor(() => expect(attempts).toBe(2)));
				yield* Effect.promise(() =>
					waitFor(() => expect(queryByRole(mounted.container, "alert")).toBeNull()),
				);
			} finally {
				mounted.unmount();
			}
		}),
	);
}

it("hides monitoring for media without a provider", () => {
	const mounted = mountRyotClient(
		{},
		<Header media={decodeFlatSummary(fixtureSummaryRecipe, { images: [], providerName: null })} />,
	);
	try {
		expect(queryByRole(mounted.container, "switch")).toBeNull();
	} finally {
		mounted.unmount();
	}
});
