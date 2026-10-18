import { expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
import { createTestBackgroundSubmissions } from "@ryot-app/plugin-client-sdk/testing";
import { fireEvent, getByLabelText, getByRole, queryByRole, waitFor } from "@testing-library/dom";
import { act } from "react";

import { MediaOwnershipSetInput } from "../../shared/media-ownership-operations";
import {
	decodeFlatSummary,
	fixtureSummaryRecipe,
} from "../../tests/client/flat-media/summary-fixture";
import { clickRyotElement, localDateTime, mountRyotClient } from "../../tests/client/test-support";
import { MediaSummaryHeader } from "./summary-header";
import type { MediaEntitySummaryValue } from "./summary-state";

const NOW = DateTime.toEpochMillis(localDateTime({ day: 20, hour: 9, month: 10, year: 2026 }));

function Header(props: {
	readonly media: MediaEntitySummaryValue;
	readonly owned: boolean | null;
	readonly ownedOn: string | null;
}) {
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
				rail: { logActivity: undefined, ownership: { owned: props.owned, ownedOn: props.ownedOn } },
			}}
		/>
	);
}

const input = (element: HTMLElement, value: string) =>
	act(() => {
		fireEvent.change(element, { target: { value } });
	});

const ownershipDialog = () => getByRole(document.body, "dialog", { name: "Mark as owned" });

const ownedOnInput = () =>
	getByLabelText(ownershipDialog(), "Owned on", { exact: false, selector: "input" });

const ownershipRequest = (request: MediaOwnershipSetInput) => ({
	input: request,
	packageId: "ryot/media",
	slug: "media-ownership-set",
	idempotencyKey: expect.any(String),
	label: request.owned ? "Marked as owned" : "Marked as not owned",
});

it.live("asks for an ownership date and applies set and unset optimistically", () =>
	Effect.gen(function* () {
		let owned: boolean | null = null;
		let ownedOn: string | null = null;
		const background = createTestBackgroundSubmissions();
		const query = createRyotQuery(() =>
			Effect.sync(() => decodeFlatSummary(fixtureSummaryRecipe, { owned, ownedOn, images: [] })),
		);
		function View() {
			const result = useRyotQuery(query);
			return result.data === undefined ? null : (
				<Header media={result.data} owned={result.data.owned} ownedOn={result.data.ownedOn} />
			);
		}
		const mounted = mountRyotClient(background.adapter, <View />);
		const commit = (attempt: number) =>
			Effect.gen(function* () {
				const decoded = yield* Schema.decodeUnknownEffect(MediaOwnershipSetInput)(
					background.requests[attempt]?.input,
				).pipe(Effect.orDie);
				owned = decoded.owned;
				ownedOn = decoded.owned ? decoded.ownedOn : null;
				background.settle(`submission-${attempt + 1}`, { status: "succeeded" });
				act(() => mounted.client.mutationCompleted.hint());
				yield* Effect.promise(() => mounted.advance(250));
			});
		try {
			yield* Effect.promise(() => mounted.setTime(NOW));
			yield* Effect.promise(() => mounted.advance(0));
			const control = getByRole(mounted.container, "button", { name: "Mark owned" });
			expect(control.getAttribute("aria-pressed")).toBe("false");
			clickRyotElement(control);
			expect(background.requests).toEqual([]);
			expect(ownedOnInput()).toHaveProperty("value", "2026-10-20");
			input(ownedOnInput(), "2026-10-21");
			const save = getByRole(ownershipDialog(), "button", { name: "Save" });
			expect(save.hasAttribute("disabled")).toBe(true);
			input(ownedOnInput(), "2024-03-04");
			clickRyotElement(save);
			yield* Effect.promise(() =>
				waitFor(() => expect(queryByRole(document.body, "dialog")).toBeNull()),
			);
			expect(background.requests).toEqual([
				ownershipRequest({ owned: true, ownedOn: "2024-03-04", entityIds: ["media-1"] }),
			]);
			expect(control.getAttribute("aria-pressed")).toBe("true");
			expect(control.textContent).toBe("Owned since Mar 4, 2024");
			yield* commit(0);
			expect(control.textContent).toBe("Owned since Mar 4, 2024");

			clickRyotElement(control);
			yield* Effect.promise(() => waitFor(() => expect(background.requests).toHaveLength(2)));
			expect(background.requests[1]).toEqual(
				ownershipRequest({ owned: false, entityIds: ["media-1"] }),
			);
			expect(control.getAttribute("aria-pressed")).toBe("false");
			expect(control.textContent).toBe("Mark owned");
			yield* commit(1);
			expect(control.getAttribute("aria-pressed")).toBe("false");
			expect(queryByRole(mounted.container, "alert")).toBeNull();
		} finally {
			mounted.unmount();
		}
	}),
);

it.live("keeps the dialog open when the shell refuses ownership without a date", () =>
	Effect.gen(function* () {
		const background = createTestBackgroundSubmissions((request) =>
			background.requests.length === 1
				? Effect.fail(new RyotClientError("operation-failed"))
				: Effect.succeed(`submission-${request.idempotencyKey}`),
		);
		const mounted = mountRyotClient(
			background.adapter,
			<Header
				owned={null}
				ownedOn={null}
				media={decodeFlatSummary(fixtureSummaryRecipe, { images: [] })}
			/>,
		);
		try {
			clickRyotElement(getByRole(mounted.container, "button", { name: "Mark owned" }));
			input(ownedOnInput(), "");
			clickRyotElement(getByRole(ownershipDialog(), "button", { name: "Save" }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(ownershipDialog().textContent).toContain(
						"Couldn't start saving ownership. Try again.",
					),
				),
			);
			expect(
				getByRole(mounted.container, "button", { name: "Mark owned" }).getAttribute("aria-pressed"),
			).toBe("false");
			clickRyotElement(getByRole(ownershipDialog(), "button", { name: "Save" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(queryByRole(document.body, "dialog")).toBeNull()),
			);
			expect(background.requests).toEqual([
				ownershipRequest({ owned: true, ownedOn: null, entityIds: ["media-1"] }),
				ownershipRequest({ owned: true, ownedOn: null, entityIds: ["media-1"] }),
			]);
			expect(background.requests[1]?.idempotencyKey).not.toBe(
				background.requests[0]?.idempotencyKey,
			);
		} finally {
			mounted.unmount();
		}
	}),
);

it.live("rolls an optimistic removal back visibly when the shell reports a failure", () =>
	Effect.gen(function* () {
		const background = createTestBackgroundSubmissions();
		const mounted = mountRyotClient(
			background.adapter,
			<Header
				owned
				ownedOn="2024-03-04"
				media={decodeFlatSummary(fixtureSummaryRecipe, { images: [] })}
			/>,
		);
		try {
			const control = getByRole(mounted.container, "button", { name: "Owned since Mar 4, 2024" });
			clickRyotElement(control);
			yield* Effect.promise(() => waitFor(() => expect(background.requests).toHaveLength(1)));
			expect(control.getAttribute("aria-pressed")).toBe("false");
			background.settle("submission-1", { status: "failed", reason: "transport" });
			expect(control.getAttribute("aria-pressed")).toBe("true");
			expect(control.textContent).toBe("Owned since Mar 4, 2024");
			expect(getByRole(mounted.container, "alert").textContent).toBe(
				"Unable to change ownership. Try again.",
			);
			clickRyotElement(control);
			yield* Effect.promise(() => waitFor(() => expect(background.requests).toHaveLength(2)));
			expect(queryByRole(mounted.container, "alert")).toBeNull();
		} finally {
			mounted.unmount();
		}
	}),
);
