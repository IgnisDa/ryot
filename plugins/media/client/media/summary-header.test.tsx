import { expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { fireEvent, getByRole, waitFor } from "@testing-library/dom";

import {
	decodeFlatSummary,
	fixtureSummaryRecipe,
} from "../../tests/client/flat-media/summary-fixture";
import { clickRyotElement, mountRyotClient } from "../../tests/client/test-support";
import { MediaExternalLink } from "./primitives";
import { MediaSummaryHeader } from "./summary-header";

it.live(
	"keeps the header preview plain, expands formatting and spoilers, and opens links through the capability",
	() =>
		Effect.gen(function* () {
			const opened: string[] = [];
			const media = decodeFlatSummary(fixtureSummaryRecipe, {
				images: [],
				description:
					"**Readable** *summary* [source](https://example.test). :spoiler[Hidden ending]",
			});
			const mounted = mountRyotClient(
				{
					openExternalLink: ({ url }) =>
						Effect.sync(() => {
							opened.push(url);
							return { outcome: "success" };
						}),
				},
				<MediaSummaryHeader
					media={media}
					compact={false}
					typeLabel="Film"
					settled={undefined}
					artwork={{ purpose: "cover", aspect: "poster" }}
					detail={{
						chips: [],
						facts: [],
						links: [],
						identityDetail: undefined,
						rail: { logActivity: false },
					}}
				/>,
			);
			try {
				const preview = mounted.container.querySelector(".line-clamp-3");
				expect(preview?.textContent).toBe("Readable summary source.");
				expect(mounted.container.textContent).not.toContain("Hidden ending");
				clickRyotElement(getByRole(mounted.container, "button", { name: "More" }));
				expect(mounted.container.querySelector("strong")?.textContent).toBe("Readable");
				clickRyotElement(getByRole(mounted.container, "button", { name: "Show spoiler" }));
				expect(
					getByRole(mounted.container, "button", { name: "Hide spoiler" }).getAttribute(
						"aria-expanded",
					),
				).toBe("true");
				clickRyotElement(getByRole(mounted.container, "link", { name: "source" }));
				yield* Effect.promise(() =>
					waitFor(() => expect(opened).toEqual(["https://example.test"])),
				);
				clickRyotElement(getByRole(mounted.container, "button", { name: "Less" }));
				expect(mounted.container.querySelector(".line-clamp-3")?.textContent).toBe(
					"Readable summary source.",
				);
			} finally {
				mounted.unmount();
			}
		}),
);

it.live(
	"preserves external link hrefs, intercepts normal and middle activation, and surfaces launch errors",
	() =>
		Effect.gen(function* () {
			const opened: string[] = [];
			const mounted = mountRyotClient(
				{
					openExternalLink: ({ url }) =>
						Effect.gen(function* () {
							opened.push(url);
							return yield* new RyotClientError("unsupported-capability");
						}),
				},
				<MediaExternalLink label="Website" href="https://example.test" />,
			);
			try {
				const link = getByRole(mounted.container, "link", { name: "Website" });
				expect(link.getAttribute("href")).toBe("https://example.test");
				expect(link.hasAttribute("target")).toBe(false);
				expect(fireEvent.click(link)).toBe(false);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(getByRole(mounted.container, "alert").textContent).toBe(
							"Unable to open link. Try again.",
						),
					),
				);
				fireEvent(link, new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
				yield* Effect.promise(() =>
					waitFor(() => expect(opened).toEqual(["https://example.test", "https://example.test"])),
				);
			} finally {
				mounted.unmount();
			}
		}),
);
