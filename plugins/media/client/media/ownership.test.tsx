import { expect } from "bun:test";

import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { getByRole, getByText } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";

import { clickRyotElement, mountRyotClient } from "../../tests/client/test-support";
import { MediaOwnershipControl } from "./ownership";

it.live("opens a title's individually addressable owned copies", () =>
	Effect.gen(function* () {
		const mounted = mountRyotClient(
			{
				query: () =>
					Effect.succeed({
						data: {
							copies: {
								type: "rows",
								pageInfo: { limit: 30, hasMore: false, nextCursor: null },
								items: [
									{
										name: "Title",
										id: "manual:disc",
										entityId: "title",
										entitySchemaSlug: "movie",
										properties: { origin: "manual", format: "uhd-blu-ray" },
									},
									{
										name: "Title",
										id: "source:file",
										entityId: "title",
										entitySchemaSlug: "movie",
										properties: { source: "plex", format: "digital", origin: "integration" },
									},
								],
							},
						},
					}),
			},
			<MediaOwnershipControl owned compact={false} entityId="title" entityName="Title" />,
		);
		try {
			clickRyotElement(getByRole(mounted.container, "button", { name: "Owned" }));
			yield* Effect.promise(() => mounted.advance(0));
			const dialog = getByRole(document.body, "dialog", { name: "Owned copies" });
			expect(dialog.textContent).toContain("Ultra HD Blu-ray");
			expect(dialog.textContent).toContain("Digital");
			clickRyotElement(getByRole(dialog, "button", { name: "Copy options" }));
			expect(getByRole(document.body, "menuitem", { name: "Remove copy" })).toBeDefined();
			clickRyotElement(getByRole(document.body, "menuitem", { name: "Edit copy" }));
			const editor = getByRole(document.body, "dialog", { name: "Edit copy" });
			expect(getByText(editor, "Format", { selector: "label" })).toBeDefined();
			expect(getByText(editor, "Resolution", { selector: "label" })).toBeDefined();
		} finally {
			mounted.unmount();
		}
	}),
);
