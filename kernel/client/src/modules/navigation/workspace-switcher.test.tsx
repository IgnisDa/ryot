import { describe, expect } from "bun:test";

import { PluginId, PluginPackageId, SavedViewId } from "@ryot-app/contract/schema/brands";
import { kernelMessage } from "@ryot-app/kernel-messages/message";
import { testFormatters, testKernelText } from "@ryot-app/kernel-messages/testing";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";
import { useState } from "react";

import {
	testI18nWrapper,
	testMessage,
	testMessageCatalog,
} from "#/modules/i18n/provider.test-support";
import {
	workspacePickerSummary,
	WorkspaceSwitcher as WorkspaceSwitcherView,
} from "#/modules/navigation/workspace-switcher";

const wrapper = testI18nWrapper([
	testMessageCatalog("Fixture", "Hidden", "Failed", "Incompatible", "Other", "Journal"),
]);

type WorkspaceSwitcherProps = Omit<
	Parameters<typeof WorkspaceSwitcherView>[0],
	"open" | "onOpenChange"
>;

function WorkspaceSwitcher(props: WorkspaceSwitcherProps) {
	const [open, setOpen] = useState(false);
	return <WorkspaceSwitcherView {...props} open={open} onOpenChange={setOpen} />;
}

const workspace = (
	overrides: Partial<PluginClientCatalogEntry> = {},
): PluginClientCatalogEntry => ({
	icon: "film",
	sortOrder: 0,
	health: "ready",
	isHidden: false,
	clientApiVersion: 1,
	clientEntities: null,
	assistantStarters: null,
	name: testMessage("Fixture"),
	contentHash: "source-fixture",
	installationId: "installation-fixture",
	...overrides,
	scope: overrides.scope ?? "system",
	homeSavedView: overrides.homeSavedView ?? null,
	packageId: overrides.packageId ?? PluginPackageId.make("ryot/fixture"),
	pluginId:
		overrides.pluginId ??
		PluginId.make(`plugin-${overrides.packageId?.split("/")[1] ?? "fixture"}`),
});

const navigation: NavigationData = { savedViews: [], collections: [] };

const view = (name: string, sortOrder: number): NavigationData["savedViews"][number] => ({
	name,
	sortOrder,
	icon: "list",
	isHidden: false,
	packageId: null,
	slug: name.toLowerCase(),
	pluginInstallationId: null,
	reference: { kind: "custom", savedViewId: SavedViewId.make(name.toLowerCase()) },
});

const fixturePackage = PluginPackageId.make("ryot/fixture");
const otherPackage = PluginPackageId.make("ryot/other");

const pickerView = (
	overrides: Partial<NavigationData["savedViews"][number]> = {},
): NavigationData["savedViews"][number] => ({
	name: "View",
	slug: "view",
	icon: "list",
	sortOrder: 0,
	isHidden: false,
	packageId: null,
	...overrides,
	reference: overrides.reference ?? {
		kind: "custom",
		savedViewId: SavedViewId.make(overrides.slug ?? "view"),
	},
	pluginInstallationId:
		overrides.pluginInstallationId ??
		(overrides.packageId ? `installation-${overrides.packageId}` : null),
});

describe("workspace switcher", () => {
	it("shows only executable workspaces and excludes hidden or unavailable entries", () => {
		const current = workspace();
		const catalog: PluginClientCatalog = [
			workspace({
				sortOrder: -1,
				isHidden: true,
				name: testMessage("Hidden"),
				installationId: "installation-disabled",
				packageId: PluginPackageId.make("test/disabled"),
			}),
			workspace({
				sortOrder: 3,
				health: "failed",
				name: testMessage("Failed"),
				installationId: "installation-failed",
				packageId: PluginPackageId.make("test/failed"),
			}),
			workspace({
				sortOrder: 2,
				health: "incompatible",
				name: testMessage("Incompatible"),
				installationId: "installation-incompatible",
				packageId: PluginPackageId.make("test/incompatible"),
			}),
			current,
		];
		render(
			<WorkspaceSwitcher
				current={current}
				catalog={catalog}
				navigation={navigation}
				onSelect={() => undefined}
				summary={kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 })}
			/>,
			{ wrapper: wrapper },
		);
		expect(screen.getByText("2 views")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /^Fixture workspace,/ }));

		const menu = screen.getByRole("menu", { name: "Workspaces" });
		expect(
			within(menu)
				.getAllByRole("menuitemradio")
				.map((item) => item.getAttribute("aria-label")),
		).toEqual(["Switch to Fixture workspace"]);
		expect(within(menu).queryByRole("menuitemradio", { name: /^Switch to Hidden / })).toBeNull();
	});

	it("renders sorted workspace view summaries and keeps the trigger summary", () => {
		const current = workspace();
		const other = workspace({
			sortOrder: 1,
			name: testMessage("Other"),
			installationId: "installation-other",
			packageId: PluginPackageId.make("test/other"),
		});
		render(
			<WorkspaceSwitcher
				current={current}
				onSelect={() => undefined}
				catalog={[current, other]}
				summary={kernelMessage("client.shell.sidebar.workspace-summary", { count: 3 })}
				navigation={{
					collections: [],
					savedViews: [
						{ ...view("Fourth", 4), pluginInstallationId: "installation-fixture" },
						{ ...view("Hidden", 0), isHidden: true, pluginInstallationId: "installation-fixture" },
						{ ...view("Second", 2), pluginInstallationId: "installation-fixture" },
						{ ...view("First", 1), pluginInstallationId: "installation-fixture" },
						{ ...view("Third", 3), pluginInstallationId: "installation-fixture" },
					],
				}}
			/>,
			{ wrapper: wrapper },
		);

		expect(screen.getByText("3 views")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /^Fixture workspace,/ }));

		const menu = screen.getByRole("menu", { name: "Workspaces" });
		expect(within(menu).getByText("First, Second, Third +1")).toBeTruthy();
		expect(within(menu).getByText("Custom workspace · 0 views")).toBeTruthy();
	});

	it.live(
		"focuses the current workspace on open and exposes its selection",
		() =>
			Effect.gen(function* () {
				const current = workspace();
				render(
					<WorkspaceSwitcher
						current={current}
						catalog={[current]}
						navigation={navigation}
						onSelect={() => undefined}
						summary={kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 })}
					/>,
					{ wrapper: wrapper },
				);

				fireEvent.click(screen.getByRole("button", { name: /^Fixture workspace,/ }));

				const item = screen.getByRole("menuitemradio", { name: /^Switch to Fixture / });
				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(item)));
				expect(item.getAttribute("aria-checked")).toBe("true");
			}),
		testTimeout,
	);

	it.live(
		"opens from its desktop shortcut and focuses the current workspace",
		() =>
			Effect.gen(function* () {
				const current = workspace();
				const other = workspace({
					sortOrder: 1,
					name: testMessage("Other"),
					installationId: "installation-other",
					packageId: PluginPackageId.make("test/other"),
				});
				render(
					<WorkspaceSwitcher
						showShortcut
						current={current}
						navigation={navigation}
						onSelect={() => undefined}
						catalog={[current, other]}
						summary={kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 })}
					/>,
					{ wrapper: wrapper },
				);
				const trigger = screen.getByRole("button", { name: /^Fixture workspace,/ });

				fireEvent.keyDown(document, { key: " ", ctrlKey: true, shiftKey: true });

				const fixture = screen.getByRole("menuitemradio", { name: /^Switch to Fixture / });
				const otherItem = screen.getByRole("menuitemradio", { name: /^Switch to Other / });
				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(fixture)));
				fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(otherItem)));
				fireEvent.keyDown(document, { key: " ", ctrlKey: true, shiftKey: true });
				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(fixture)));
				expect(screen.getByRole("menu", { name: "Workspaces" })).toBeTruthy();
				expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Mod+Shift+Space");
				const shortcutHint = screen.getByText("Space");
				expect(shortcutHint.tagName).toBe("KBD");
				expect(shortcutHint.getAttribute("aria-hidden")).toBe("true");
			}),
		testTimeout,
	);

	it("renders only from its controlled open value and reports close requests", () => {
		const changes: boolean[] = [];
		const current = workspace();
		const props = {
			current,
			navigation,
			catalog: [current],
			onSelect: () => undefined,
			onOpenChange: (open: boolean) => changes.push(open),
			summary: kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 }),
		};
		const rendered = render(<WorkspaceSwitcherView {...props} open />, { wrapper: wrapper });

		fireEvent.click(screen.getByRole("button", { name: /^Fixture workspace,/ }));

		expect(changes).toEqual([false]);
		expect(screen.getByRole("menu", { name: "Workspaces" })).toBeTruthy();

		rendered.rerender(<WorkspaceSwitcherView {...props} open={false} />);
		expect(screen.queryByRole("menu", { name: "Workspaces" })).toBeNull();
	});

	it.live(
		"focuses the current workspace when externally reopened after a stale active item",
		() =>
			Effect.gen(function* () {
				const current = workspace();
				const other = workspace({
					sortOrder: 1,
					name: testMessage("Other"),
					installationId: "installation-other",
					packageId: PluginPackageId.make("test/other"),
				});
				const journal = workspace({
					sortOrder: 2,
					name: testMessage("Journal"),
					installationId: "installation-journal",
					packageId: PluginPackageId.make("test/journal"),
				});
				const props = {
					current,
					navigation,
					onSelect: () => undefined,
					onOpenChange: () => undefined,
					catalog: [current, other, journal],
					summary: kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 }),
				};
				const rendered = render(<WorkspaceSwitcherView {...props} open />, { wrapper: wrapper });
				const fixture = screen.getByRole("menuitemradio", { name: /^Switch to Fixture / });
				const otherItem = screen.getByRole("menuitemradio", { name: /^Switch to Other / });
				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(fixture)));

				fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(otherItem)));

				rendered.rerender(<WorkspaceSwitcherView {...props} open={false} />);
				rendered.rerender(<WorkspaceSwitcherView {...props} open current={journal} />);

				const journalItem = screen.getByRole("menuitemradio", { name: /^Switch to Journal / });
				yield* Effect.promise(() =>
					waitFor(() => expect(document.activeElement).toBe(journalItem)),
				);
			}),
		testTimeout,
	);

	it("does not register the desktop shortcut when it is not enabled", () => {
		const current = workspace();
		render(
			<WorkspaceSwitcher
				current={current}
				catalog={[current]}
				navigation={navigation}
				onSelect={() => undefined}
				summary={kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 })}
			/>,
			{ wrapper: wrapper },
		);

		fireEvent.keyDown(document, { key: " ", ctrlKey: true, shiftKey: true });

		expect(screen.queryByRole("menu")).toBeNull();
		expect(
			screen.getByRole("button", { name: /^Fixture workspace,/ }).getAttribute("aria-keyshortcuts"),
		).toBe(null);
	});

	it.live(
		"closes when its trigger is clicked while the menu owns focus",
		() =>
			Effect.gen(function* () {
				const user = userEvent.setup();
				const current = workspace();
				render(
					<WorkspaceSwitcher
						current={current}
						catalog={[current]}
						navigation={navigation}
						onSelect={() => undefined}
						summary={kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 })}
					/>,
					{ wrapper: wrapper },
				);
				const trigger = screen.getByRole("button", { name: /^Fixture workspace,/ });
				fireEvent.click(trigger);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(document.activeElement).toBe(
							screen.getByRole("menuitemradio", { name: /^Switch to Fixture / }),
						),
					),
				);

				yield* Effect.promise(() => user.click(trigger));

				yield* Effect.promise(() =>
					waitFor(() => {
						expect(screen.queryByRole("menu") === null).toBe(true);
						expect(document.activeElement === trigger).toBe(true);
					}),
				);
			}),
		testTimeout,
	);

	it.live(
		"dismisses on outside pointer interaction without restoring trigger focus",
		() =>
			Effect.gen(function* () {
				const current = workspace();
				render(
					<>
						<WorkspaceSwitcher
							current={current}
							catalog={[current]}
							navigation={navigation}
							onSelect={() => undefined}
							summary={kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 })}
						/>
						<button type="button">Outside</button>
					</>,
					{ wrapper: wrapper },
				);
				const trigger = screen.getByRole("button", { name: /^Fixture workspace,/ });
				fireEvent.click(trigger);
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(document.activeElement).toBe(
							screen.getByRole("menuitemradio", { name: /^Switch to Fixture / }),
						),
					),
				);

				const outside = screen.getByRole("button", { name: "Outside" });
				fireEvent.pointerDown(outside);
				outside.focus();

				expect(screen.queryByRole("menu")).toBeNull();
				expect(document.activeElement).toBe(outside);
			}),
		testTimeout,
	);

	it.live(
		"does not select the current workspace and restores trigger focus",
		() =>
			Effect.gen(function* () {
				const selections: string[] = [];
				const current = workspace();
				render(
					<WorkspaceSwitcher
						current={current}
						catalog={[current]}
						navigation={navigation}
						onSelect={({ pluginId }) => {
							selections.push(pluginId);
						}}
						summary={kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 })}
					/>,
					{ wrapper: wrapper },
				);
				const trigger = screen.getByRole("button", { name: /^Fixture workspace,/ });
				fireEvent.click(trigger);

				fireEvent.click(screen.getByRole("menuitemradio", { name: /^Switch to Fixture / }));

				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(trigger)));
				expect(screen.queryByRole("menu")).toBeNull();
				expect(selections).toEqual([]);
			}),
		testTimeout,
	);

	it.live(
		"closes and restores trigger focus before selecting another workspace",
		() =>
			Effect.gen(function* () {
				const user = userEvent.setup();
				const current = workspace();
				const observations: Array<{ slug: string; open: boolean; focused: boolean }> = [];
				render(
					<WorkspaceSwitcher
						current={current}
						navigation={navigation}
						summary={kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 })}
						catalog={[
							current,
							workspace({
								name: testMessage("Other"),
								installationId: "installation-other",
								packageId: PluginPackageId.make("test/other"),
							}),
						]}
						onSelect={({ pluginId }) => {
							observations.push({
								slug: pluginId,
								open: screen.queryByRole("menu") !== null,
								focused: document.activeElement === trigger,
							});
						}}
					/>,
					{ wrapper: wrapper },
				);
				const trigger = screen.getByRole("button", { name: /^Fixture workspace,/ });
				trigger.focus();
				yield* Effect.promise(() => user.keyboard("{ArrowDown}"));
				const selected = yield* Effect.promise(() =>
					screen.findByRole("menuitemradio", { name: /^Switch to Fixture / }),
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(document.activeElement === selected).toBe(true)),
				);

				yield* Effect.promise(() => user.keyboard("{ArrowDown}{Enter}"));

				yield* Effect.promise(() =>
					waitFor(() =>
						expect(observations).toEqual([{ open: false, focused: true, slug: "plugin-other" }]),
					),
				);
			}),
		testTimeout,
	);

	it.live(
		"closes with Escape and restores trigger focus",
		() =>
			Effect.gen(function* () {
				const current = workspace();
				render(
					<WorkspaceSwitcher
						current={current}
						catalog={[current]}
						navigation={navigation}
						onSelect={() => undefined}
						summary={kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 })}
					/>,
					{ wrapper: wrapper },
				);
				const trigger = screen.getByRole("button", { name: /^Fixture workspace,/ });
				fireEvent.click(trigger);

				fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(trigger)));
				expect(screen.queryByRole("menu")).toBeNull();
			}),
		testTimeout,
	);

	it.live(
		"moves through workspace choices with arrow, Home, and End keys",
		() =>
			Effect.gen(function* () {
				const current = workspace();
				render(
					<WorkspaceSwitcher
						current={current}
						navigation={navigation}
						onSelect={() => undefined}
						summary={kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 })}
						catalog={[
							current,
							workspace({
								sortOrder: 1,
								name: testMessage("Other"),
								installationId: "installation-other",
								packageId: PluginPackageId.make("test/other"),
							}),
							workspace({
								sortOrder: 2,
								name: testMessage("Journal"),
								installationId: "installation-journal",
								packageId: PluginPackageId.make("test/journal"),
							}),
						]}
					/>,
					{ wrapper: wrapper },
				);
				fireEvent.click(screen.getByRole("button", { name: /^Fixture workspace,/ }));
				const menu = screen.getByRole("menu");
				const fixture = screen.getByRole("menuitemradio", { name: /^Switch to Fixture / });
				const other = screen.getByRole("menuitemradio", { name: /^Switch to Other / });
				const journal = screen.getByRole("menuitemradio", { name: /^Switch to Journal / });
				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(fixture)));

				fireEvent.keyDown(menu, { key: "ArrowDown" });
				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(other)));
				fireEvent.keyDown(menu, { key: "End" });
				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(journal)));
				fireEvent.keyDown(menu, { key: "ArrowDown" });
				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(fixture)));
				fireEvent.keyDown(menu, { key: "ArrowUp" });
				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(journal)));
				fireEvent.keyDown(menu, { key: "Home" });
				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(fixture)));
			}),
		testTimeout,
	);

	it.live(
		"closes on Tab departure without pulling focus back",
		() =>
			Effect.gen(function* () {
				const user = userEvent.setup();
				const current = workspace();
				render(
					<>
						<WorkspaceSwitcher
							current={current}
							catalog={[current]}
							navigation={navigation}
							onSelect={() => undefined}
							summary={kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 })}
						/>
						<button type="button">After switcher</button>
					</>,
					{ wrapper: wrapper },
				);
				fireEvent.click(screen.getByRole("button", { name: /^Fixture workspace,/ }));
				yield* Effect.promise(() =>
					waitFor(() =>
						expect(document.activeElement).toBe(
							screen.getByRole("menuitemradio", { name: /^Switch to Fixture / }),
						),
					),
				);

				yield* Effect.promise(() => user.tab());

				expect(screen.queryByRole("menu")).toBeNull();
				expect(document.activeElement).toBe(screen.getByRole("button", { name: "After switcher" }));
			}),
		testTimeout,
	);

	it("offers no customize entry when the consumer supplies no handler", () => {
		const current = workspace();
		render(
			<WorkspaceSwitcher
				current={current}
				catalog={[current]}
				navigation={navigation}
				onSelect={() => undefined}
				summary={kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 })}
			/>,
			{ wrapper: wrapper },
		);

		fireEvent.click(screen.getByRole("button", { name: /^Fixture workspace,/ }));

		expect(screen.queryByRole("menuitem", { name: "Customize sidebar" })).toBeNull();
	});

	it("closes before reporting a customize request", () => {
		const events: string[] = [];
		const current = workspace();
		render(
			<WorkspaceSwitcher
				current={current}
				catalog={[current]}
				navigation={navigation}
				onSelect={() => undefined}
				summary={kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 })}
				onCustomize={() => events.push(screen.queryByRole("menu") === null ? "closed" : "open")}
			/>,
			{ wrapper: wrapper },
		);

		fireEvent.click(screen.getByRole("button", { name: /^Fixture workspace,/ }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Customize sidebar" }));

		return waitFor(() => expect(events).toEqual(["closed"]));
	});

	it.live(
		"walks the arrow keys past the workspaces onto the customize entry",
		() =>
			Effect.gen(function* () {
				const current = workspace();
				render(
					<WorkspaceSwitcher
						current={current}
						catalog={[current]}
						navigation={navigation}
						onSelect={() => undefined}
						onCustomize={() => undefined}
						summary={kernelMessage("client.shell.sidebar.workspace-summary", { count: 2 })}
					/>,
					{ wrapper: wrapper },
				);

				fireEvent.click(screen.getByRole("button", { name: /^Fixture workspace,/ }));
				const menu = screen.getByRole("menu", { name: "Workspaces" });
				fireEvent.keyDown(menu, { key: "ArrowDown" });

				yield* Effect.promise(() =>
					waitFor(() =>
						expect(document.activeElement).toBe(
							screen.getByRole("menuitem", { name: "Customize sidebar" }),
						),
					),
				);
			}),
		testTimeout,
	);
});

describe("workspace picker summary", () => {
	it("formats a workspace picker summary from enabled views in sort order", () => {
		const data: NavigationData = {
			collections: [],
			savedViews: [
				pickerView({ sortOrder: 4, name: "Fourth", slug: "fourth", packageId: fixturePackage }),
				pickerView({
					sortOrder: 0,
					name: "Hidden",
					isHidden: true,
					slug: "disabled",
					packageId: fixturePackage,
				}),
				pickerView({ sortOrder: 2, name: "Second", slug: "second", packageId: fixturePackage }),
				pickerView({ sortOrder: 1, name: "Other", slug: "other", packageId: otherPackage }),
				pickerView({ sortOrder: 1, name: "First", slug: "first", packageId: fixturePackage }),
			],
		};

		expect<string>(
			workspacePickerSummary(testFormatters, data, "installation-ryot/fixture", testKernelText),
		).toBe("First, Second, Fourth");
		expect<string>(
			workspacePickerSummary(testFormatters, data, "installation-ryot/other", testKernelText),
		).toBe("Other");
	});

	it("adds the remaining count and handles empty workspaces", () => {
		const data: NavigationData = {
			collections: [],
			savedViews: [
				pickerView({ sortOrder: 0, name: "First", slug: "first", packageId: fixturePackage }),
				pickerView({ sortOrder: 1, name: "Second", slug: "second", packageId: fixturePackage }),
				pickerView({ sortOrder: 2, name: "Third", slug: "third", packageId: fixturePackage }),
				pickerView({ sortOrder: 3, name: "Fourth", slug: "fourth", packageId: fixturePackage }),
			],
		};

		expect<string>(
			workspacePickerSummary(testFormatters, data, "installation-ryot/fixture", testKernelText),
		).toBe("First, Second, Third +1");
		expect<string>(
			workspacePickerSummary(testFormatters, data, "installation-ryot/other", testKernelText),
		).toBe("Custom workspace · 0 views");
	});
});
