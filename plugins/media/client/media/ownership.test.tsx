import { expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect, Schema } from "@ryot-app/plugin-client-sdk/effect";
import { createRyotQuery, useRyotQuery } from "@ryot-app/plugin-client-sdk/react";
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

it.live("asks for an ownership date, validates it, and clears it when ownership is removed", () =>
	Effect.gen(function* () {
		const requests: unknown[] = [];
		let owned: boolean | null = null;
		let ownedOn: string | null = null;
		const query = createRyotQuery(() =>
			Effect.sync(() => decodeFlatSummary(fixtureSummaryRecipe, { owned, ownedOn, images: [] })),
		);
		function View() {
			const result = useRyotQuery(query);
			return result.data === undefined ? null : (
				<Header media={result.data} owned={result.data.owned} ownedOn={result.data.ownedOn} />
			);
		}
		const mounted = mountRyotClient(
			{
				invokeOperation: (request) =>
					Effect.gen(function* () {
						requests.push(request);
						const decoded = yield* Schema.decodeUnknownEffect(MediaOwnershipSetInput)(
							request.input,
						).pipe(Effect.orDie);
						owned = decoded.owned;
						ownedOn = decoded.owned ? decoded.ownedOn : null;
						return { results: [{ owned, ownedOn, status: "found", entityId: "media-1" }] };
					}),
			},
			<View />,
		);
		try {
			yield* Effect.promise(() => mounted.setTime(NOW));
			yield* Effect.promise(() => mounted.advance(0));
			const control = getByRole(mounted.container, "button", { name: "Mark owned" });
			expect(control.getAttribute("aria-pressed")).toBe("false");
			clickRyotElement(control);
			expect(requests).toEqual([]);
			expect(ownedOnInput()).toHaveProperty("value", "2026-10-20");
			input(ownedOnInput(), "2026-10-21");
			const save = getByRole(ownershipDialog(), "button", { name: "Save" });
			expect(save.hasAttribute("disabled")).toBe(true);
			input(ownedOnInput(), "2024-03-04");
			clickRyotElement(save);
			yield* Effect.promise(() =>
				waitFor(() => expect(queryByRole(document.body, "dialog")).toBeNull()),
			);
			expect(requests).toEqual([
				{
					packageId: "ryot/media",
					slug: "media-ownership-set",
					input: { owned: true, ownedOn: "2024-03-04", entityIds: ["media-1"] },
				},
			]);
			yield* Effect.promise(() => mounted.advance(250));
			expect(control.getAttribute("aria-pressed")).toBe("true");
			expect(control.textContent).toBe("Owned since Mar 4, 2024");
			clickRyotElement(control);
			yield* Effect.promise(() => waitFor(() => expect(requests).toHaveLength(2)));
			expect(requests[1]).toEqual({
				packageId: "ryot/media",
				slug: "media-ownership-set",
				input: { owned: false, entityIds: ["media-1"] },
			});
			yield* Effect.promise(() =>
				waitFor(() => expect(control.hasAttribute("disabled")).toBe(false)),
			);
			yield* Effect.promise(() => mounted.advance(250));
			expect(control.getAttribute("aria-pressed")).toBe("false");
			expect(control.textContent).toBe("Mark owned");
		} finally {
			mounted.unmount();
		}
	}),
);

it.live("records ownership without a date and keeps the dialog open after a failure", () =>
	Effect.gen(function* () {
		const requests: unknown[] = [];
		const mounted = mountRyotClient(
			{
				invokeOperation: (request) =>
					Effect.gen(function* () {
						requests.push(request);
						if (requests.length === 1) {
							return yield* new RyotClientError("unsupported-capability");
						}
						return {
							results: [{ owned: true, ownedOn: null, status: "found", entityId: "media-1" }],
						};
					}),
			},
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
					expect(ownershipDialog().textContent).toContain("Unable to save ownership. Try again."),
				),
			);
			clickRyotElement(getByRole(ownershipDialog(), "button", { name: "Save" }));
			yield* Effect.promise(() =>
				waitFor(() => expect(queryByRole(document.body, "dialog")).toBeNull()),
			);
			expect(requests).toEqual([
				{
					packageId: "ryot/media",
					slug: "media-ownership-set",
					input: { owned: true, ownedOn: null, entityIds: ["media-1"] },
				},
				{
					packageId: "ryot/media",
					slug: "media-ownership-set",
					input: { owned: true, ownedOn: null, entityIds: ["media-1"] },
				},
			]);
		} finally {
			mounted.unmount();
		}
	}),
);

for (const failure of ["transport", "missing", "mismatched", "unchanged"] as const) {
	it.live(`keeps ownership and allows retry after a ${failure} result when removing it`, () =>
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
													ownedOn: null,
													status: "found",
													owned: failure === "unchanged",
													entityId: failure === "mismatched" ? "other" : "media-1",
												},
									],
								};
							}
							return {
								results: [{ owned: false, ownedOn: null, status: "found", entityId: "media-1" }],
							};
						}),
				},
				<Header
					owned
					ownedOn="2024-03-04"
					media={decodeFlatSummary(fixtureSummaryRecipe, { images: [] })}
				/>,
			);
			try {
				const control = getByRole(mounted.container, "button", { name: "Owned since Mar 4, 2024" });
				clickRyotElement(control);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(getByRole(mounted.container, "alert").textContent).toBe(
							"Unable to change ownership. Try again.",
						),
					),
				);
				expect(control.getAttribute("aria-pressed")).toBe("true");
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
