import { afterEach, describe, expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
	useParams,
	useRouterState,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";
import { useState } from "react";

import {
	MainViewProvider,
	mainViewRouterOptions,
	useMainViewIdentity,
} from "#/modules/navigation/main-view";
import { MAIN_CONTENT_ID, mainContentProps } from "#/modules/navigation/skip-link";

function Item() {
	const itemId = useRouterState({ select: (state) => state.location.pathname.split("/").at(-1) });
	return (
		<main {...mainContentProps}>
			<h1>Item {itemId}</h1>
			<button type="button">Act</button>
		</main>
	);
}

function StandalonePage() {
	const pageId = useRouterState({ select: (state) => state.location.pathname.split("/").at(-1) });
	return (
		<main {...mainContentProps} className="ui-page">
			<h1>Page {pageId}</h1>
			<button type="button">Act</button>
		</main>
	);
}

function Embedded() {
	const { _splat } = useParams({ strict: false });
	const [claimed, setClaimed] = useState(false);
	useMainViewIdentity(claimed ? "embedded" : undefined);
	return (
		<main {...mainContentProps}>
			<h1>Embedded {_splat}</h1>
			<button type="button">Act</button>
			<button type="button" onClick={() => setClaimed(true)}>
				Claim
			</button>
		</main>
	);
}

const mount = (initialEntry: string) => {
	const root = createRootRoute({
		component: () => (
			<MainViewProvider>
				<Outlet />
			</MainViewProvider>
		),
	});
	const router = createRouter({
		...mainViewRouterOptions,
		history: createMemoryHistory({ initialEntries: [initialEntry] }),
		routeTree: root.addChildren([
			createRoute({ component: Item, path: "/items/$itemId", getParentRoute: () => root }),
			createRoute({ path: "/embedded/$", component: Embedded, getParentRoute: () => root }),
			createRoute({
				path: "/pages/$pageId",
				component: StandalonePage,
				getParentRoute: () => root,
			}),
		]),
	});
	render(<RouterProvider router={router} />);
	return router;
};

const mainContent = () => {
	const element = document.getElementById(MAIN_CONTENT_ID);
	if (element === null) {
		throw new Error("expected the main content element");
	}
	return element;
};

const scrollMain = (top: number) => {
	const element = mainContent();
	element.scrollTop = top;
	element.dispatchEvent(new Event("scroll"));
	return element;
};

const scrollDocument = (top: number) => {
	document.documentElement.scrollTop = top;
	document.dispatchEvent(new Event("scroll"));
};

afterEach(() => {
	document.documentElement.scrollTop = 0;
});

const navigate = (router: ReturnType<typeof mount>, href: string) =>
	Effect.promise(() => act(() => router.navigate({ href })));

const heading = (name: string) =>
	Effect.promise(() => waitFor(() => screen.getByRole("heading", { name })));

describe("MainViewProvider", () => {
	it.live(
		"leaves focus alone on the initial load",
		() =>
			Effect.gen(function* () {
				mount("/items/a");
				yield* heading("Item a");

				expect(document.activeElement).toBe(document.body);
			}),
		testTimeout,
	);

	it.live(
		"starts different content at the top with focus on the main view",
		() =>
			Effect.gen(function* () {
				const router = mount("/items/a");
				yield* heading("Item a");
				const reused = scrollMain(400);
				screen.getByRole("button", { name: "Act" }).focus();

				yield* navigate(router, "/items/b");
				yield* heading("Item b");

				expect(mainContent()).toBe(reused);
				expect(reused.scrollTop).toBe(0);
				expect(document.activeElement).toBe(reused);
			}),
		testTimeout,
	);

	it.live(
		"keeps scroll and focus when only the location of the same content changes",
		() =>
			Effect.gen(function* () {
				const router = mount("/items/a");
				yield* heading("Item a");
				const main = scrollMain(400);
				const action = screen.getByRole("button", { name: "Act" });
				action.focus();

				yield* navigate(router, "/items/a?tab=stats");
				yield* Effect.promise(() =>
					waitFor(() => expect(router.state.resolvedLocation?.searchStr).toBe("?tab=stats")),
				);

				expect(main.scrollTop).toBe(400);
				expect(document.activeElement).toBe(action);
			}),
		testTimeout,
	);

	it.live(
		"restores the scroll position of the entry returned to",
		() =>
			Effect.gen(function* () {
				const router = mount("/items/a");
				yield* heading("Item a");
				scrollMain(400);
				yield* navigate(router, "/embedded/one");
				yield* heading("Embedded one");
				expect(mainContent().scrollTop).toBe(0);

				act(() => router.history.back());
				yield* heading("Item a");

				yield* Effect.promise(() => waitFor(() => expect(mainContent().scrollTop).toBe(400)));
				expect(document.activeElement).toBe(mainContent());
			}),
		testTimeout,
	);

	it.live(
		"leaves navigation inside a claimed main view to its owner",
		() =>
			Effect.gen(function* () {
				const router = mount("/embedded/one");
				yield* heading("Embedded one");
				fireEvent.click(screen.getByRole("button", { name: "Claim" }));
				expect(document.activeElement).toBe(document.body);
				const main = scrollMain(400);
				const action = screen.getByRole("button", { name: "Act" });
				action.focus();

				yield* navigate(router, "/embedded/two");
				yield* heading("Embedded two");

				expect(main.scrollTop).toBe(400);
				expect(document.activeElement).toBe(action);
			}),
		testTimeout,
	);

	describe("on a page that scrolls the document", () => {
		it.live(
			"leaves focus alone on the initial load",
			() =>
				Effect.gen(function* () {
					mount("/pages/a");
					yield* heading("Page a");

					expect(document.activeElement).toBe(document.body);
				}),
			testTimeout,
		);

		it.live(
			"starts different content at the top with focus on the main view",
			() =>
				Effect.gen(function* () {
					const router = mount("/pages/a");
					yield* heading("Page a");
					scrollDocument(400);
					screen.getByRole("button", { name: "Act" }).focus();

					yield* navigate(router, "/pages/b");
					yield* heading("Page b");

					expect(document.documentElement.scrollTop).toBe(0);
					expect(document.activeElement).toBe(mainContent());
				}),
			testTimeout,
		);

		it.live(
			"keeps scroll and focus when only the search changes",
			() =>
				Effect.gen(function* () {
					const router = mount("/pages/a");
					yield* heading("Page a");
					scrollDocument(400);
					const action = screen.getByRole("button", { name: "Act" });
					action.focus();

					yield* navigate(router, "/pages/a?step=2");
					yield* Effect.promise(() =>
						waitFor(() => expect(router.state.resolvedLocation?.searchStr).toBe("?step=2")),
					);

					expect(document.documentElement.scrollTop).toBe(400);
					expect(document.activeElement).toBe(action);
				}),
			testTimeout,
		);

		it.live(
			"restores the document position of the entry returned to",
			() =>
				Effect.gen(function* () {
					const router = mount("/pages/a");
					yield* heading("Page a");
					scrollDocument(400);
					yield* navigate(router, "/items/x");
					yield* heading("Item x");
					expect(document.documentElement.scrollTop).toBe(0);

					act(() => router.history.back());
					yield* heading("Page a");

					yield* Effect.promise(() =>
						waitFor(() => expect(document.documentElement.scrollTop).toBe(400)),
					);
					expect(document.activeElement).toBe(mainContent());
				}),
			testTimeout,
		);
	});
});
