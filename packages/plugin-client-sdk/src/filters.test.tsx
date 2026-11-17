import { afterEach, describe, expect } from "bun:test";

import { TimeZone } from "@ryot-app/contract/schema/time-zone";
import type { Text } from "@ryot-app/i18n/text";
import { testKernelText, testText } from "@ryot-app/kernel-messages/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, screen, waitFor } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
	activeFiltersMessage,
	FilterChips,
	FilterRules,
	type ViewFilter,
	type ViewFilterField,
	ViewFiltersSheet,
} from "./filters";
import { disposePluginBridges, mountPluginPage, routeLocation, TestI18nProvider } from "./testing";

const roots: Root[] = [];

const renderSheet = (compact: boolean, title: Text) => {
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() =>
		root.render(
			<TestI18nProvider>
				<ViewFiltersSheet title={title} compact={compact} onClose={() => undefined}>
					<p>Sheet body</p>
				</ViewFiltersSheet>
			</TestI18nProvider>,
		),
	);
};

describe("filter labels", () => {
	it("pluralizes the active filter phrase", () => {
		expect<string>(testKernelText(activeFiltersMessage(1))).toBe("1 active filter");
		expect<string>(testKernelText(activeFiltersMessage(0))).toBe("0 active filters");
	});
});

describe("ViewFiltersSheet", () => {
	afterEach(() => {
		act(() => roots.splice(0).forEach((root) => root.unmount()));
		document.body.replaceChildren();
	});

	it("titles the dialog and names its close control from the title", () => {
		renderSheet(false, testText("View options"));
		expect(screen.getByRole("heading", { level: 2, name: "View options" })).toBeTruthy();
		expect(screen.getByRole("dialog", { name: "View options" })).toBeTruthy();
		expect(screen.getByText("Sheet body")).toBeTruthy();
		expect(screen.getAllByLabelText("Close").length).toBeGreaterThan(0);
	});

	it("anchors to the bottom edge when compact", () => {
		renderSheet(true, testText("Filters"));
		expect(screen.getByRole("dialog", { name: "Filters" }).className).toContain("rounded-t-xl");
	});
});

describe("rating filters", () => {
	afterEach(disposePluginBridges);

	const fields: readonly ViewFilterField[] = [
		{ kind: "value", type: "rating", key: "userRating", label: "Your rating" },
	];

	it.live(
		"edits and summarizes stored ratings in the user's scale",
		() =>
			Effect.gen(function* () {
				const changes: unknown[] = [];
				const filter: ViewFilter = { value: 75, operator: "gte", field: "userRating" };
				mountPluginPage(
					() => (
						<>
							<FilterChips
								fields={fields}
								filter={filter}
								onOpen={() => undefined}
								onChange={() => undefined}
							/>
							<FilterRules
								fields={fields}
								filter={filter}
								compact={false}
								onChange={(next) => changes.push(next)}
							/>
						</>
					),
					{
						location: routeLocation("/"),
						userPreferences: { weekStart: 1, ratingScale: "ten", timeZone: TimeZone.make("UTC") },
						page: {
							settings: {},
							contributors: [],
							dataSources: null,
							route: { params: {} },
							view: { icon: "grid", name: "Browser" },
							renderer: { kind: "kernel", name: "Browser" },
							target: { kind: "saved-view", reference: { kind: "kernel", slug: "browser" } },
						},
					},
				);
				const input = yield* Effect.promise(() =>
					waitFor(() => screen.getByRole("spinbutton", { name: "Your rating value" })),
				);
				expect(input).toHaveProperty("value", "7.5");
				expect(input.getAttribute("max")).toBe("10");
				expect(screen.getByText("Your rating is at least 7.5")).toBeTruthy();
				fireEvent.change(input, { target: { value: "8" } });
				expect(changes.at(-1)).toEqual({ value: 80, operator: "gte", field: "userRating" });
			}),
		testTimeout,
	);
});

describe("filter entitlements", () => {
	afterEach(disposePluginBridges);

	const fields: readonly ViewFilterField[] = [
		{ key: "name", type: "text", kind: "value", label: "Name" },
		{ type: "date", kind: "value", key: "addedAt", label: "Date added" },
	];

	it.live(
		"limits free accounts to one rule without date operators",
		() =>
			Effect.gen(function* () {
				const filter: ViewFilter = { value: "dune", field: "name", operator: "contains" };
				mountPluginPage(
					() => (
						<FilterRules
							fields={fields}
							filter={filter}
							compact={false}
							onChange={() => undefined}
						/>
					),
					{
						entitlements: [],
						location: routeLocation("/"),
						userPreferences: { weekStart: 1, ratingScale: "ten", timeZone: TimeZone.make("UTC") },
						page: {
							settings: {},
							contributors: [],
							dataSources: null,
							route: { params: {} },
							view: { icon: "grid", name: "Browser" },
							renderer: { kind: "kernel", name: "Browser" },
							target: { kind: "saved-view", reference: { kind: "kernel", slug: "browser" } },
						},
					},
				);
				const add = yield* Effect.promise(() =>
					waitFor(() => screen.getByRole("button", { name: "Add filter: Add filter (Pro)" })),
				);
				expect(add).toHaveProperty("disabled", true);
				fireEvent.click(screen.getByRole("button", { name: /^Filter 1 field: / }));
				fireEvent.click(
					yield* Effect.promise(() =>
						waitFor(() => screen.getByRole("radio", { name: "Date added" })),
					),
				);
				fireEvent.click(
					yield* Effect.promise(() =>
						waitFor(() => screen.getByRole("button", { name: "Filter 1 operator: is not set" })),
					),
				);
				const after = yield* Effect.promise(() =>
					waitFor(() => screen.getByRole("radio", { name: "is after (Pro)" })),
				);
				expect(after.getAttribute("aria-disabled")).toBe("true");
			}),
		testTimeout,
	);
});
