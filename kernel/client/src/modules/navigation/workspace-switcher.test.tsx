import { describe, expect, it } from "@effect/vitest";
import { PluginId, SavedViewId, PluginPackageId } from "@ryot-app/contract/schema/brands";
import type { NavigationData } from "@ryot-app/ryotql-recipes/navigation";
import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Effect } from "effect";
import { useState } from "react";

import { WorkspaceSwitcher as WorkspaceSwitcherView } from "#/modules/navigation/workspace-switcher";

type WorkspaceSwitcherProps = Omit<
	Parameters<typeof WorkspaceSwitcherView>[0],
	"onOpenChange" | "open"
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
	name: "Media",
	health: "ready",
	isHidden: false,
	clientApiVersion: 1,
	sourceHash: "source-media",
	installationId: "installation-media",
	...overrides,
	scope: overrides.scope ?? "system",
	homeSavedView: overrides.homeSavedView ?? null,
	packageId: overrides.packageId ?? PluginPackageId.make("ryot/media"),
	pluginId:
		overrides.pluginId ?? PluginId.make(`plugin-${overrides.packageId?.split("/")[1] ?? "media"}`),
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

describe("workspace switcher", () => {
	it("shows only executable workspaces and excludes hidden or unavailable entries", () => {
		const current = workspace();
		const catalog: PluginClientCatalog = [
			workspace({
				sortOrder: -1,
				name: "Hidden",
				isHidden: true,
				installationId: "installation-disabled",
				packageId: PluginPackageId.make("test/disabled"),
			}),
			workspace({
				sortOrder: 3,
				name: "Failed",
				health: "failed",
				installationId: "installation-failed",
				packageId: PluginPackageId.make("test/failed"),
			}),
			workspace({
				sortOrder: 2,
				name: "Incompatible",
				health: "incompatible",
				installationId: "installation-incompatible",
				packageId: PluginPackageId.make("test/incompatible"),
			}),
			current,
		];
		render(
			<WorkspaceSwitcher
				summary="2 views"
				current={current}
				catalog={catalog}
				navigation={navigation}
				onSelect={() => undefined}
			/>,
		);
		expect(screen.getByText("2 views")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: /^Media workspace,/ }));

		const menu = screen.getByRole("menu", { name: "Workspaces" });
		expect(
			within(menu)
				.getAllByRole("menuitemradio")
				.map((item) => item.getAttribute("aria-label")),
		).toEqual(["Switch to Media · System · ryot/media workspace"]);
		expect(within(menu).queryByRole("menuitemradio", { name: /^Switch to Hidden / })).toBeNull();
	});

	it("renders sorted workspace view summaries and keeps the trigger summary", () => {
		const current = workspace();
		const fitness = workspace({
			sortOrder: 1,
			name: "Fitness",
			installationId: "installation-fitness",
			packageId: PluginPackageId.make("test/fitness"),
		});
		render(
			<WorkspaceSwitcher
				current={current}
				summary="3 views"
				onSelect={() => undefined}
				catalog={[current, fitness]}
				navigation={{
					collections: [],
					savedViews: [
						{ ...view("Fourth", 4), pluginInstallationId: "installation-media" },
						{ ...view("Hidden", 0), isHidden: true, pluginInstallationId: "installation-media" },
						{ ...view("Second", 2), pluginInstallationId: "installation-media" },
						{ ...view("First", 1), pluginInstallationId: "installation-media" },
						{ ...view("Third", 3), pluginInstallationId: "installation-media" },
					],
				}}
			/>,
		);

		expect(screen.getByText("3 views")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: /^Media workspace,/ }));

		const menu = screen.getByRole("menu", { name: "Workspaces" });
		expect(within(menu).getByText("First, Second, Third +1")).toBeTruthy();
		expect(within(menu).getByText("Custom workspace · 0 views")).toBeTruthy();
	});

	it.live("focuses the current workspace on open and exposes its selection", () =>
		Effect.gen(function* () {
			const current = workspace();
			render(
				<WorkspaceSwitcher
					current={current}
					summary="2 views"
					catalog={[current]}
					navigation={navigation}
					onSelect={() => undefined}
				/>,
			);

			fireEvent.click(screen.getByRole("button", { name: /^Media workspace,/ }));

			const item = screen.getByRole("menuitemradio", { name: /^Switch to Media / });
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(item)));
			expect(item.getAttribute("aria-checked")).toBe("true");
		}),
	);

	it.live("opens from its desktop shortcut and focuses the current workspace", () =>
		Effect.gen(function* () {
			const current = workspace();
			const fitness = workspace({
				sortOrder: 1,
				name: "Fitness",
				installationId: "installation-fitness",
				packageId: PluginPackageId.make("test/fitness"),
			});
			render(
				<WorkspaceSwitcher
					showShortcut
					summary="2 views"
					current={current}
					navigation={navigation}
					onSelect={() => undefined}
					catalog={[current, fitness]}
				/>,
			);
			const trigger = screen.getByRole("button", { name: /^Media workspace,/ });

			fireEvent.keyDown(document, { key: " ", ctrlKey: true, shiftKey: true });

			const media = screen.getByRole("menuitemradio", { name: /^Switch to Media / });
			const fitnessItem = screen.getByRole("menuitemradio", { name: /^Switch to Fitness / });
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(media)));
			fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(fitnessItem)));
			fireEvent.keyDown(document, { key: " ", ctrlKey: true, shiftKey: true });
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(media)));
			expect(screen.getByRole("menu", { name: "Workspaces" })).toBeTruthy();
			expect(trigger.getAttribute("aria-keyshortcuts")).toBe("Mod+Shift+Space");
			expect(screen.getByText("⌘⇧Space")).toBeTruthy();
		}),
	);

	it("renders only from its controlled open value and reports close requests", () => {
		const changes: boolean[] = [];
		const current = workspace();
		const props = {
			current,
			navigation,
			summary: "2 views",
			catalog: [current],
			onSelect: () => undefined,
			onOpenChange: (open: boolean) => changes.push(open),
		};
		const rendered = render(<WorkspaceSwitcherView {...props} open />);

		fireEvent.click(screen.getByRole("button", { name: /^Media workspace,/ }));

		expect(changes).toEqual([false]);
		expect(screen.getByRole("menu", { name: "Workspaces" })).toBeTruthy();

		rendered.rerender(<WorkspaceSwitcherView {...props} open={false} />);
		expect(screen.queryByRole("menu", { name: "Workspaces" })).toBeNull();
	});

	it.live("focuses the current workspace when externally reopened after a stale active item", () =>
		Effect.gen(function* () {
			const current = workspace();
			const fitness = workspace({
				sortOrder: 1,
				name: "Fitness",
				installationId: "installation-fitness",
				packageId: PluginPackageId.make("test/fitness"),
			});
			const journal = workspace({
				sortOrder: 2,
				name: "Journal",
				installationId: "installation-journal",
				packageId: PluginPackageId.make("test/journal"),
			});
			const props = {
				current,
				navigation,
				summary: "2 views",
				onSelect: () => undefined,
				onOpenChange: () => undefined,
				catalog: [current, fitness, journal],
			};
			const rendered = render(<WorkspaceSwitcherView {...props} open />);
			const media = screen.getByRole("menuitemradio", { name: /^Switch to Media / });
			const fitnessItem = screen.getByRole("menuitemradio", { name: /^Switch to Fitness / });
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(media)));

			fireEvent.keyDown(screen.getByRole("menu"), { key: "ArrowDown" });
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(fitnessItem)));

			rendered.rerender(<WorkspaceSwitcherView {...props} open={false} />);
			rendered.rerender(<WorkspaceSwitcherView {...props} open current={journal} />);

			const journalItem = screen.getByRole("menuitemradio", { name: /^Switch to Journal / });
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(journalItem)));
		}),
	);

	it("does not register the desktop shortcut when it is not enabled", () => {
		const current = workspace();
		render(
			<WorkspaceSwitcher
				current={current}
				summary="2 views"
				catalog={[current]}
				navigation={navigation}
				onSelect={() => undefined}
			/>,
		);

		fireEvent.keyDown(document, { key: " ", ctrlKey: true, shiftKey: true });

		expect(screen.queryByRole("menu")).toBeNull();
		expect(
			screen.getByRole("button", { name: /^Media workspace,/ }).getAttribute("aria-keyshortcuts"),
		).toBe(null);
	});

	it.live("closes when its trigger is clicked while the menu owns focus", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const current = workspace();
			render(
				<WorkspaceSwitcher
					current={current}
					summary="2 views"
					catalog={[current]}
					navigation={navigation}
					onSelect={() => undefined}
				/>,
			);
			const trigger = screen.getByRole("button", { name: /^Media workspace,/ });
			fireEvent.click(trigger);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(document.activeElement).toBe(
						screen.getByRole("menuitemradio", { name: /^Switch to Media / }),
					),
				),
			);

			yield* Effect.promise(() => user.click(trigger));

			expect(screen.queryByRole("menu")).toBeNull();
			expect(document.activeElement).toBe(trigger);
		}),
	);

	it.live("dismisses on outside pointer interaction without restoring trigger focus", () =>
		Effect.gen(function* () {
			const current = workspace();
			render(
				<>
					<WorkspaceSwitcher
						summary="2 views"
						current={current}
						catalog={[current]}
						navigation={navigation}
						onSelect={() => undefined}
					/>
					<button type="button">Outside</button>
				</>,
			);
			const trigger = screen.getByRole("button", { name: /^Media workspace,/ });
			fireEvent.click(trigger);
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(document.activeElement).toBe(
						screen.getByRole("menuitemradio", { name: /^Switch to Media / }),
					),
				),
			);

			const outside = screen.getByRole("button", { name: "Outside" });
			fireEvent.pointerDown(outside);
			outside.focus();

			expect(screen.queryByRole("menu")).toBeNull();
			expect(document.activeElement).toBe(outside);
		}),
	);

	it.live("does not select the current workspace and restores trigger focus", () =>
		Effect.gen(function* () {
			const selections: string[] = [];
			const current = workspace();
			render(
				<WorkspaceSwitcher
					summary="2 views"
					current={current}
					catalog={[current]}
					navigation={navigation}
					onSelect={({ pluginId }) => {
						selections.push(pluginId);
					}}
				/>,
			);
			const trigger = screen.getByRole("button", { name: /^Media workspace,/ });
			fireEvent.click(trigger);

			fireEvent.click(screen.getByRole("menuitemradio", { name: /^Switch to Media / }));

			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(trigger)));
			expect(screen.queryByRole("menu")).toBeNull();
			expect(selections).toEqual([]);
		}),
	);

	it.live("closes and restores trigger focus before selecting another workspace", () =>
		Effect.gen(function* () {
			const current = workspace();
			const observations: Array<{ focused: boolean; open: boolean; slug: string }> = [];
			render(
				<WorkspaceSwitcher
					current={current}
					summary="2 views"
					navigation={navigation}
					catalog={[
						current,
						workspace({
							name: "Fitness",
							installationId: "installation-fitness",
							packageId: PluginPackageId.make("test/fitness"),
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
			);
			const trigger = screen.getByRole("button", { name: /^Media workspace,/ });
			fireEvent.click(trigger);

			fireEvent.click(screen.getByRole("menuitemradio", { name: /^Switch to Fitness / }));

			yield* Effect.promise(() =>
				waitFor(() =>
					expect(observations).toEqual([{ open: false, focused: true, slug: "plugin-fitness" }]),
				),
			);
		}),
	);

	it.live("closes with Escape and restores trigger focus", () =>
		Effect.gen(function* () {
			const current = workspace();
			render(
				<WorkspaceSwitcher
					current={current}
					summary="2 views"
					catalog={[current]}
					navigation={navigation}
					onSelect={() => undefined}
				/>,
			);
			const trigger = screen.getByRole("button", { name: /^Media workspace,/ });
			fireEvent.click(trigger);

			fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(trigger)));
			expect(screen.queryByRole("menu")).toBeNull();
		}),
	);

	it.live("moves through workspace choices with arrow, Home, and End keys", () =>
		Effect.gen(function* () {
			const current = workspace();
			render(
				<WorkspaceSwitcher
					summary="2 views"
					current={current}
					navigation={navigation}
					onSelect={() => undefined}
					catalog={[
						current,
						workspace({
							sortOrder: 1,
							name: "Fitness",
							installationId: "installation-fitness",
							packageId: PluginPackageId.make("test/fitness"),
						}),
						workspace({
							sortOrder: 2,
							name: "Journal",
							installationId: "installation-journal",
							packageId: PluginPackageId.make("test/journal"),
						}),
					]}
				/>,
			);
			fireEvent.click(screen.getByRole("button", { name: /^Media workspace,/ }));
			const menu = screen.getByRole("menu");
			const media = screen.getByRole("menuitemradio", { name: /^Switch to Media / });
			const fitness = screen.getByRole("menuitemradio", { name: /^Switch to Fitness / });
			const journal = screen.getByRole("menuitemradio", { name: /^Switch to Journal / });
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(media)));

			fireEvent.keyDown(menu, { key: "ArrowDown" });
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(fitness)));
			fireEvent.keyDown(menu, { key: "End" });
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(journal)));
			fireEvent.keyDown(menu, { key: "ArrowDown" });
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(media)));
			fireEvent.keyDown(menu, { key: "ArrowUp" });
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(journal)));
			fireEvent.keyDown(menu, { key: "Home" });
			yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(media)));
		}),
	);

	it.live("closes on Tab departure without pulling focus back", () =>
		Effect.gen(function* () {
			const user = userEvent.setup();
			const current = workspace();
			render(
				<>
					<WorkspaceSwitcher
						summary="2 views"
						current={current}
						catalog={[current]}
						navigation={navigation}
						onSelect={() => undefined}
					/>
					<button type="button">After switcher</button>
				</>,
			);
			fireEvent.click(screen.getByRole("button", { name: /^Media workspace,/ }));
			yield* Effect.promise(() =>
				waitFor(() =>
					expect(document.activeElement).toBe(
						screen.getByRole("menuitemradio", { name: /^Switch to Media / }),
					),
				),
			);

			yield* Effect.promise(() => user.tab());

			expect(screen.queryByRole("menu")).toBeNull();
			expect(document.activeElement).toBe(screen.getByRole("button", { name: "After switcher" }));
		}),
	);

	it("offers no customize entry when the consumer supplies no handler", () => {
		const current = workspace();
		render(
			<WorkspaceSwitcher
				current={current}
				summary="2 views"
				catalog={[current]}
				navigation={navigation}
				onSelect={() => undefined}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /^Media workspace,/ }));

		expect(screen.queryByRole("menuitem", { name: "Customize sidebar" })).toBeNull();
	});

	it("closes before reporting a customize request", () => {
		const events: string[] = [];
		const current = workspace();
		render(
			<WorkspaceSwitcher
				current={current}
				summary="2 views"
				catalog={[current]}
				navigation={navigation}
				onSelect={() => undefined}
				onCustomize={() => events.push(screen.queryByRole("menu") === null ? "closed" : "open")}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: /^Media workspace,/ }));
		fireEvent.click(screen.getByRole("menuitem", { name: "Customize sidebar" }));

		return waitFor(() => expect(events).toEqual(["closed"]));
	});

	it.live("walks the arrow keys past the workspaces onto the customize entry", () =>
		Effect.gen(function* () {
			const current = workspace();
			render(
				<WorkspaceSwitcher
					current={current}
					summary="2 views"
					catalog={[current]}
					navigation={navigation}
					onSelect={() => undefined}
					onCustomize={() => undefined}
				/>,
			);

			fireEvent.click(screen.getByRole("button", { name: /^Media workspace,/ }));
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
	);
});
