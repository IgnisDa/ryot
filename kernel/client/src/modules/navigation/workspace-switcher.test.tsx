import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot-app/ryotql-recipes/plugin-client-catalog";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WorkspaceSwitcher } from "#/modules/navigation/workspace-switcher";

const workspace = (
	overrides: Partial<PluginClientCatalogEntry> = {},
): PluginClientCatalogEntry => ({
	icon: "film",
	name: "Media",
	slug: "media",
	health: "ready",
	sortOrder: 0,
	isDisabled: false,
	clientApiVersion: 1,
	pluginId: "plugin-media",
	sourceHash: "source-media",
	installationId: "installation-media",
	clientArtifactHash: "artifact-media",
	...overrides,
});

describe("workspace switcher", () => {
	it("shows enabled workspaces in deterministic order without hiding unavailable entries", () => {
		const current = workspace();
		const catalog: PluginClientCatalog = [
			workspace({
				sortOrder: -1,
				slug: "disabled",
				name: "Disabled",
				isDisabled: true,
				installationId: "installation-disabled",
			}),
			workspace({
				sortOrder: 3,
				slug: "failed",
				name: "Failed",
				health: "failed",
				installationId: "installation-failed",
			}),
			workspace({
				sortOrder: 2,
				slug: "incompatible",
				name: "Incompatible",
				health: "incompatible",
				installationId: "installation-incompatible",
			}),
			workspace({
				sortOrder: 1,
				name: "Clientless",
				slug: "clientless",
				clientApiVersion: null,
				clientArtifactHash: null,
				installationId: "installation-clientless",
			}),
			current,
		];
		render(
			<WorkspaceSwitcher
				summary="2 views"
				current={current}
				catalog={catalog}
				onSelect={() => undefined}
			/>,
		);
		expect(screen.getByText("2 views")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Media workspace, media" }));

		const menu = screen.getByRole("menu", { name: "Workspaces" });
		expect(
			within(menu)
				.getAllByRole("menuitemradio")
				.map((item) => item.getAttribute("aria-label")),
		).toEqual([
			"Switch to Media workspace",
			"Switch to Clientless workspace",
			"Switch to Incompatible workspace",
			"Switch to Failed workspace",
		]);
		expect(
			within(menu).queryByRole("menuitemradio", { name: "Switch to Disabled workspace" }),
		).toBeNull();
	});

	it("focuses the current workspace on open and exposes its selection", async () => {
		const current = workspace();
		render(
			<WorkspaceSwitcher
				current={current}
				summary="2 views"
				catalog={[current]}
				onSelect={() => undefined}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Media workspace, media" }));

		const item = screen.getByRole("menuitemradio", { name: "Switch to Media workspace" });
		await waitFor(() => expect(document.activeElement).toBe(item));
		expect(item.getAttribute("aria-checked")).toBe("true");
	});

	it("closes when its trigger is clicked while the menu owns focus", async () => {
		const user = userEvent.setup();
		const current = workspace();
		render(
			<WorkspaceSwitcher
				current={current}
				summary="2 views"
				catalog={[current]}
				onSelect={() => undefined}
			/>,
		);
		const trigger = screen.getByRole("button", { name: "Media workspace, media" });
		fireEvent.click(trigger);
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("menuitemradio", { name: "Switch to Media workspace" }),
			),
		);

		await user.click(trigger);

		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("dismisses on outside pointer interaction without restoring trigger focus", async () => {
		const current = workspace();
		render(
			<>
				<WorkspaceSwitcher
					summary="2 views"
					current={current}
					catalog={[current]}
					onSelect={() => undefined}
				/>
				<button type="button">Outside</button>
			</>,
		);
		const trigger = screen.getByRole("button", { name: "Media workspace, media" });
		fireEvent.click(trigger);
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("menuitemradio", { name: "Switch to Media workspace" }),
			),
		);

		const outside = screen.getByRole("button", { name: "Outside" });
		fireEvent.pointerDown(outside);
		outside.focus();

		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(outside);
	});

	it("does not select the current workspace and restores trigger focus", async () => {
		const selections: string[] = [];
		const current = workspace();
		render(
			<WorkspaceSwitcher
				summary="2 views"
				current={current}
				catalog={[current]}
				onSelect={(slug) => {
					selections.push(slug);
				}}
			/>,
		);
		const trigger = screen.getByRole("button", { name: "Media workspace, media" });
		fireEvent.click(trigger);

		fireEvent.click(screen.getByRole("menuitemradio", { name: "Switch to Media workspace" }));

		await waitFor(() => expect(document.activeElement).toBe(trigger));
		expect(screen.queryByRole("menu")).toBeNull();
		expect(selections).toEqual([]);
	});

	it("closes and restores trigger focus before selecting another workspace", async () => {
		const current = workspace();
		const observations: Array<{ focused: boolean; open: boolean; slug: string }> = [];
		render(
			<WorkspaceSwitcher
				current={current}
				summary="2 views"
				catalog={[
					current,
					workspace({ name: "Fitness", slug: "fitness", installationId: "installation-fitness" }),
				]}
				onSelect={(slug) => {
					observations.push({
						slug,
						focused: document.activeElement === trigger,
						open: screen.queryByRole("menu") !== null,
					});
				}}
			/>,
		);
		const trigger = screen.getByRole("button", { name: "Media workspace, media" });
		fireEvent.click(trigger);

		fireEvent.click(screen.getByRole("menuitemradio", { name: "Switch to Fitness workspace" }));

		await waitFor(() =>
			expect(observations).toEqual([{ slug: "fitness", focused: true, open: false }]),
		);
	});

	it("closes with Escape and restores trigger focus", async () => {
		const current = workspace();
		render(
			<WorkspaceSwitcher
				current={current}
				summary="2 views"
				catalog={[current]}
				onSelect={() => undefined}
			/>,
		);
		const trigger = screen.getByRole("button", { name: "Media workspace, media" });
		fireEvent.click(trigger);

		fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

		await waitFor(() => expect(document.activeElement).toBe(trigger));
		expect(screen.queryByRole("menu")).toBeNull();
	});

	it("moves through workspace choices with arrow, Home, and End keys", async () => {
		const current = workspace();
		render(
			<WorkspaceSwitcher
				summary="2 views"
				current={current}
				onSelect={() => undefined}
				catalog={[
					current,
					workspace({
						sortOrder: 1,
						name: "Fitness",
						slug: "fitness",
						installationId: "installation-fitness",
					}),
					workspace({
						sortOrder: 2,
						name: "Journal",
						slug: "journal",
						installationId: "installation-journal",
					}),
				]}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Media workspace, media" }));
		const menu = screen.getByRole("menu");
		const media = screen.getByRole("menuitemradio", { name: "Switch to Media workspace" });
		const fitness = screen.getByRole("menuitemradio", { name: "Switch to Fitness workspace" });
		const journal = screen.getByRole("menuitemradio", { name: "Switch to Journal workspace" });
		await waitFor(() => expect(document.activeElement).toBe(media));

		fireEvent.keyDown(menu, { key: "ArrowDown" });
		await waitFor(() => expect(document.activeElement).toBe(fitness));
		fireEvent.keyDown(menu, { key: "End" });
		await waitFor(() => expect(document.activeElement).toBe(journal));
		fireEvent.keyDown(menu, { key: "ArrowDown" });
		await waitFor(() => expect(document.activeElement).toBe(media));
		fireEvent.keyDown(menu, { key: "ArrowUp" });
		await waitFor(() => expect(document.activeElement).toBe(journal));
		fireEvent.keyDown(menu, { key: "Home" });
		await waitFor(() => expect(document.activeElement).toBe(media));
	});

	it("closes on Tab departure without pulling focus back", async () => {
		const user = userEvent.setup();
		const current = workspace();
		render(
			<>
				<WorkspaceSwitcher
					summary="2 views"
					current={current}
					catalog={[current]}
					onSelect={() => undefined}
				/>
				<button type="button">After switcher</button>
			</>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Media workspace, media" }));
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("menuitemradio", { name: "Switch to Media workspace" }),
			),
		);

		await user.tab();

		expect(screen.queryByRole("menu")).toBeNull();
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "After switcher" }));
	});
});
