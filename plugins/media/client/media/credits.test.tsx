import { afterEach, describe, expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { getByRole, queryByRole, waitFor } from "@testing-library/dom";

import { showRecipes } from "../../shared/show-recipes";
import { rowsResult } from "../../tests/client/query-result-fixture";
import { showPersonRow } from "../../tests/client/show/overview-fixture";
import {
	clickRyotElement,
	flushRyotClient,
	mountRyotClient,
} from "../../tests/client/test-support";
import { createMediaCreditsQuery, MediaCreditsButton } from "./credits";

const query = createMediaCreditsQuery(showRecipes.peopleRecipe);

const button = (
	<MediaCreditsButton
		compact
		query={query}
		aspect="square"
		safeAreaTop={12}
		purpose="profile"
		title="Cast & crew"
		label="View all people"
		input={{ entityId: "show-1" }}
		unlinked={[{ role: "Writer", name: "Unlinked Writer" }]}
	/>
);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("credit lists", () => {
	it.live("loads on open, appends credits, and restores trigger focus on close", () =>
		Effect.gen(function* () {
			const documents: unknown[] = [];
			const view = mountRyotClient(
				{
					watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
					query: (document) => {
						documents.push(document);
						const next = JSON.stringify(document).includes("cursor-1");
						return Effect.succeed({
							data: {
								people: rowsResult(
									[
										next
											? { ...showPersonRow, id: "person-2", character: null, name: "Second Person" }
											: { ...showPersonRow, character: "Jamie / Narrator" },
									],
									{ limit: 30, hasMore: !next, nextCursor: next ? null : "cursor-1" },
								),
							},
						});
					},
				},
				button,
			);
			expect(documents).toHaveLength(0);
			const trigger = getByRole(view.container, "button", { name: "View all people" });
			clickRyotElement(trigger);
			yield* Effect.promise(() => flushRyotClient());
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(getByRole(document.body, "link", { name: "Open Owen Cooper" })).toBeDefined(),
				),
			);
			const dialog = getByRole(document.body, "dialog", { name: "Cast & crew" });
			expect(dialog.textContent).toContain("Actor");
			expect(dialog.textContent).toContain("as Jamie / Narrator");
			expect(dialog.textContent).toContain("Unlinked Writer");
			expect(getByRole(dialog, "link", { name: "Open Owen Cooper" }).getAttribute("href")).toBe(
				"/e/person-1",
			);
			clickRyotElement(getByRole(dialog, "button", { name: "Load more" }));
			yield* Effect.promise(() => flushRyotClient());
			yield* Effect.promise(() =>
				waitFor(() => expect(dialog.textContent).toContain("Second Person")),
			);
			expect(dialog.textContent).toContain("Owen Cooper");
			expect(getByRole(dialog, "link", { name: "Open Second Person" }).textContent).not.toContain(
				"as ",
			);
			expect(documents).toHaveLength(2);
			expect(queryByRole(dialog, "button", { name: "Load more" })).toBeNull();
			clickRyotElement(getByRole(dialog, "button", { name: "Close credits" }));
			expect(queryByRole(document.body, "dialog")).toBeNull();
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(trigger)));
			view.unmount();
		}),
	);

	it.live("shows a failed request and allows retry without closing the modal", () =>
		Effect.gen(function* () {
			let requests = 0;
			const view = mountRyotClient(
				{
					watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
					query: () => {
						requests += 1;
						return requests === 1
							? Effect.fail(new RyotClientError("transport"))
							: Effect.succeed({
									data: { people: rowsResult([], { limit: 30, hasMore: false, nextCursor: null }) },
								});
					},
				},
				button,
			);
			clickRyotElement(getByRole(view.container, "button", { name: "View all people" }));
			yield* Effect.promise(() => flushRyotClient());
			const dialog = getByRole(document.body, "dialog");
			yield* Effect.promise(() =>
				waitFor(() => expect(dialog.textContent).toContain("Unable to load these credits")),
			);
			clickRyotElement(getByRole(dialog, "button", { name: "Try again" }));
			yield* Effect.promise(() => flushRyotClient());
			yield* Effect.promise(() =>
				waitFor(() => expect(dialog.textContent).toContain("No linked credits found.")),
			);
			expect(dialog.textContent).toContain("Unlinked Writer");
			view.unmount();
		}),
	);
});
