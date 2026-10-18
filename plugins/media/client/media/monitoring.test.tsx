import { expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { createTestBackgroundSubmissions } from "@ryot-app/plugin-client-sdk/testing";
import { getByRole, queryByRole, waitFor } from "@testing-library/dom";
import { act } from "react";

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
				rail: { logActivity: undefined },
			}}
		/>
	);
}

const monitoringRequest = (enable: boolean) => ({
	packageId: "ryot/media",
	input: { entityIds: ["media-1"] },
	idempotencyKey: expect.any(String),
	label: enable ? "Started monitoring" : "Stopped monitoring",
	slug: enable ? "media-monitoring-enable" : "media-monitoring-disable",
});

it.live(
	"enables and disables monitoring optimistically and keeps library state from refreshes",
	() =>
		Effect.gen(function* () {
			let monitored = false;
			let inLibrary = false;
			const background = createTestBackgroundSubmissions();
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
			const mounted = mountRyotClient(background.adapter, <View />);
			const commit = (attempt: number, enable: boolean) =>
				Effect.gen(function* () {
					monitored = enable;
					inLibrary ||= enable;
					background.settle(`submission-${attempt}`, { status: "succeeded" });
					act(() => mounted.client.mutationCompleted.hint());
					yield* Effect.promise(() => mounted.advance(250));
				});
			try {
				yield* Effect.promise(() => mounted.advance(0));
				const control = getByRole(mounted.container, "button", { name: "Monitor" });
				expect(control.getAttribute("aria-pressed")).toBe("false");
				clickRyotElement(control);
				yield* Effect.promise(() => waitFor(() => expect(background.requests).toHaveLength(1)));
				expect(background.requests).toEqual([monitoringRequest(true)]);
				expect(control.getAttribute("aria-pressed")).toBe("true");
				expect(control.textContent).toBe("Monitoring");
				yield* commit(1, true);
				expect(control.getAttribute("aria-pressed")).toBe("true");
				expect(mounted.container.textContent).toContain("In your library");

				clickRyotElement(control);
				yield* Effect.promise(() => waitFor(() => expect(background.requests).toHaveLength(2)));
				expect(background.requests[1]).toEqual(monitoringRequest(false));
				expect(control.getAttribute("aria-pressed")).toBe("false");
				yield* commit(2, false);
				expect(control.getAttribute("aria-pressed")).toBe("false");
				expect(mounted.container.textContent).toContain("In your library");
			} finally {
				mounted.unmount();
			}
		}),
);

it.live("rolls monitoring back visibly when the shell reports a failure", () =>
	Effect.gen(function* () {
		const background = createTestBackgroundSubmissions();
		const mounted = mountRyotClient(
			background.adapter,
			<Header media={decodeFlatSummary(fixtureSummaryRecipe, { images: [] })} />,
		);
		try {
			const control = getByRole(mounted.container, "button", { name: "Monitor" });
			clickRyotElement(control);
			yield* Effect.promise(() => waitFor(() => expect(background.requests).toHaveLength(1)));
			expect(control.getAttribute("aria-pressed")).toBe("true");
			background.settle("submission-1", {
				status: "failed",
				reason: "operation-rejected",
				message: "Monitoring needs a provider",
			});
			expect(control.getAttribute("aria-pressed")).toBe("false");
			expect(getByRole(mounted.container, "alert").textContent).toBe(
				"Unable to change monitoring. Try again.",
			);
			clickRyotElement(control);
			yield* Effect.promise(() => waitFor(() => expect(background.requests).toHaveLength(2)));
			expect(queryByRole(mounted.container, "alert")).toBeNull();
		} finally {
			mounted.unmount();
		}
	}),
);

it("hides monitoring for media without a provider", () => {
	const mounted = mountRyotClient(
		{},
		<Header media={decodeFlatSummary(fixtureSummaryRecipe, { images: [], providerName: null })} />,
	);
	try {
		expect(queryByRole(mounted.container, "button", { name: "Monitor" })).toBeNull();
	} finally {
		mounted.unmount();
	}
});
