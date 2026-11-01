import { afterEach, describe, expect, it } from "@effect/vitest";
import { RyotClientError } from "@ryot-app/plugin-client-sdk";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import { getAllByRole, getByRole, queryByRole, waitFor } from "@testing-library/dom";

import { movieRecipes } from "../../shared/movie-recipes";
import { showRecipes } from "../../shared/show-recipes";
import { rowsResult } from "../../tests/client/query-result-fixture";
import { showCompanyRow, showPersonRow } from "../../tests/client/show/overview-fixture";
import {
	clickRyotElement,
	flushRyotClient,
	mountRyotClient,
} from "../../tests/client/test-support";
import { screenCreditFilters } from "../creator/credit-filters";
import { createMediaCreditsQuery, MediaCreditsButton } from "./credits";

const query = createMediaCreditsQuery(showRecipes.peopleRecipe);
const movieQuery = createMediaCreditsQuery(movieRecipes.peopleRecipe);
const personRow = {
	...showPersonRow,
	isGuest: null,
	creditKinds: null,
	departments: null,
	isUncredited: null,
};

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
	for (const compact of [false, true]) {
		it.live(
			`keeps the fourteenth of eighteen credits reachable in the ${compact ? "compact" : "desktop"} scroll panel`,
			() =>
				Effect.gen(function* () {
					const view = mountRyotClient(
						{
							watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
							query: () =>
								Effect.succeed({
									data: {
										people: rowsResult(
											Array.from({ length: 18 }, (_, index) => ({
												...personRow,
												order: null,
												id: `person-${index}`,
												name: index === 13 ? "Nicole Kidman" : `Person ${index}`,
											})),
											{ limit: 30, hasMore: false, nextCursor: null },
										),
									},
								}),
						},
						<MediaCreditsButton
							aspect="square"
							safeAreaTop={0}
							compact={compact}
							purpose="profile"
							query={movieQuery}
							title="Cast & crew"
							label="View all people"
							input={{ entityId: "movie-1" }}
						/>,
					);
					clickRyotElement(getByRole(view.container, "button", { name: "View all people" }));
					yield* Effect.promise(() => flushRyotClient());
					const dialog = getByRole(document.body, "dialog", { name: "Cast & crew" });
					yield* Effect.promise(() =>
						waitFor(() => expect(getAllByRole(dialog, "link")).toHaveLength(18)),
					);
					const person = getByRole(dialog, "link", { name: "Open Nicole Kidman" });
					expect(getAllByRole(dialog, "link")[13]).toBe(person);
					const scrollPanel = person.closest(".overflow-y-auto");
					expect(scrollPanel?.classList.contains("min-h-0")).toBe(true);
					expect(scrollPanel?.classList.contains("flex-1")).toBe(true);
					expect(dialog.classList.contains("h-full")).toBe(true);
					expect(dialog.classList.contains("overflow-hidden")).toBe(true);
					person.focus();
					expect(document.activeElement).toBe(person);
					expect(queryByRole(dialog, "button", { name: "Load more" })).toBeNull();
					view.unmount();
				}),
		);
	}

	it.live("pages three complete company lists with logo artwork and no person fields", () =>
		Effect.gen(function* () {
			const documents: string[] = [];
			const companyQuery = createMediaCreditsQuery(showRecipes.companiesRecipe);
			const view = mountRyotClient(
				{
					watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
					query: (document) => {
						const serialized = JSON.stringify(document);
						documents.push(serialized);
						let page = 0;
						if (serialized.includes("companies-2")) {
							page = 2;
						} else if (serialized.includes("companies-1")) {
							page = 1;
						}
						return Effect.succeed({
							data: {
								companies: rowsResult(
									Array.from({ length: 30 }, (_, index) => ({
										...showCompanyRow,
										id: `company-${page * 30 + index}`,
										name: `Company ${page * 30 + index}`,
									})),
									{
										limit: 30,
										hasMore: page < 2,
										nextCursor: page < 2 ? `companies-${page + 1}` : null,
									},
								),
							},
						});
					},
				},
				<MediaCreditsButton
					compact
					purpose="logo"
					aspect="square"
					safeAreaTop={0}
					title="Companies"
					query={companyQuery}
					label="View all companies"
					input={{ entityId: "show-1" }}
				/>,
			);
			clickRyotElement(getByRole(view.container, "button", { name: "View all companies" }));
			yield* Effect.promise(() => flushRyotClient());
			const dialog = getByRole(document.body, "dialog", { name: "Companies" });
			yield* Effect.promise(() =>
				waitFor(() => expect(getAllByRole(dialog, "link")).toHaveLength(30)),
			);
			for (const count of [60, 90]) {
				clickRyotElement(getByRole(dialog, "button", { name: "Load more" }));
				yield* Effect.promise(() => flushRyotClient());
				yield* Effect.promise(() =>
					waitFor(() => expect(getAllByRole(dialog, "link")).toHaveLength(count)),
				);
			}
			expect(dialog.textContent).toContain("Company 89");
			expect(dialog.querySelector("img")?.getAttribute("src")).toContain("warp.png");
			expect(dialog.textContent).toContain("Production Company");
			expect(queryByRole(dialog, "button", { name: "Load more" })).toBeNull();
			expect(documents).toHaveLength(3);
			expect(documents.join("")).not.toContain("character");
			expect(documents.join("")).not.toContain("creditKinds");
			view.unmount();
		}),
	);

	it.live(
		"resets paged person credits for each server-side filter without filtering returned rows",
		() =>
			Effect.gen(function* () {
				const documents: string[] = [];
				const view = mountRyotClient(
					{
						watchEntities: () => ({ update: () => undefined, dispose: () => undefined }),
						query: (document) => {
							const serialized = JSON.stringify(document);
							documents.push(serialized);
							let page = 0;
							if (serialized.includes("people-2")) {
								page = 2;
							} else if (serialized.includes("people-1")) {
								page = 1;
							}
							return Effect.succeed({
								data: {
									people: rowsResult(
										Array.from({ length: 30 }, (_, index) => ({
											...personRow,
											departments: ["Direction"],
											id: `person-${page * 30 + index}`,
											name: `Person ${page * 30 + index}`,
										})),
										{
											limit: 30,
											hasMore: page < 2,
											nextCursor: page < 2 ? `people-${page + 1}` : null,
										},
									),
								},
							});
						},
					},
					<MediaCreditsButton
						compact
						query={query}
						title="People"
						aspect="square"
						safeAreaTop={0}
						purpose="profile"
						label="View all people"
						filters={screenCreditFilters}
						input={{ entityId: "show-1" }}
					/>,
				);
				clickRyotElement(getByRole(view.container, "button", { name: "View all people" }));
				yield* Effect.promise(() => flushRyotClient());
				const dialog = getByRole(document.body, "dialog", { name: "People" });
				yield* Effect.promise(() =>
					waitFor(() => expect(getAllByRole(dialog, "link")).toHaveLength(30)),
				);
				for (const count of [60, 90]) {
					clickRyotElement(getByRole(dialog, "button", { name: "Load more" }));
					yield* Effect.promise(() => flushRyotClient());
					yield* Effect.promise(() =>
						waitFor(() => expect(getAllByRole(dialog, "link")).toHaveLength(count)),
					);
				}
				expect(dialog.textContent).toContain("Direction");
				for (const [label, choice] of [
					["Credit kind", "Cast"],
					["Guest credits", "Exclude explicitly marked"],
					["Uncredited credits", "Only explicitly marked"],
				] satisfies readonly (readonly [string, string])[]) {
					clickRyotElement(getByRole(dialog, "button", { name: new RegExp(`^${label}:`) }));
					yield* Effect.promise(() => flushRyotClient());
					const picker = getByRole(document.body, "dialog", { name: label });
					clickRyotElement(getByRole(picker, "radio", { name: choice }));
					yield* Effect.promise(() => flushRyotClient());
					yield* Effect.promise(() =>
						waitFor(() => expect(getAllByRole(dialog, "link")).toHaveLength(30)),
					);
					expect(documents.at(-1)).not.toContain('"after"');
					expect(queryByRole(dialog, "link", { name: "Open Person 89" })).toBeNull();
				}
				expect(documents.at(-1)).toContain('"cast"');
				expect(documents.at(-1)).toContain("isGuest");
				expect(documents.at(-1)).toContain("isUncredited");
				expect(getByRole(dialog, "link", { name: "Open Person 0" })).toBeDefined();
				view.unmount();
			}),
	);

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
											? { ...personRow, id: "person-2", character: null, name: "Second Person" }
											: { ...personRow, isInMediaLibrary: true, character: "Jamie / Narrator" },
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
			expect(
				getByRole(dialog, "link", { name: "Open Owen Cooper" }).querySelector(
					'[aria-label="In your library"]',
				),
			).not.toBeNull();
			expect(getByRole(dialog, "link", { name: "Open Owen Cooper" }).getAttribute("href")).toBe(
				"/e/person-1",
			);
			clickRyotElement(getByRole(dialog, "button", { name: "Load more" }));
			yield* Effect.promise(() => flushRyotClient());
			yield* Effect.promise(() =>
				waitFor(() => expect(dialog.textContent).toContain("Second Person")),
			);
			expect(dialog.textContent).toContain("Owen Cooper");
			expect(
				getByRole(dialog, "link", { name: "Open Second Person" }).querySelector(
					'[aria-label="In your library"]',
				),
			).toBeNull();
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
							? Effect.fail(new RyotClientError({ reason: "transport" }))
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
