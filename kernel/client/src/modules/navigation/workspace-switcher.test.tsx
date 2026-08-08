import type {
	PluginClientCatalog,
	PluginClientCatalogEntry,
} from "@ryot/ryotql-recipes/plugin-client-catalog";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
		render(<WorkspaceSwitcher current={current} catalog={catalog} onSelect={() => undefined} />);

		fireEvent.click(screen.getByRole("button", { name: "Media workspace, media" }));

		const dialog = screen.getByRole("dialog", { name: "Workspaces" });
		expect(
			within(dialog)
				.getAllByRole("button")
				.map((item) => item.getAttribute("aria-label")),
		).toEqual([
			"Switch to Media workspace",
			"Switch to Clientless workspace",
			"Switch to Incompatible workspace",
			"Switch to Failed workspace",
		]);
		expect(
			within(dialog).queryByRole("button", { name: "Switch to Disabled workspace" }),
		).toBeNull();
	});

	it("does not select the current workspace and restores trigger focus", async () => {
		const selections: string[] = [];
		const current = workspace();
		render(
			<WorkspaceSwitcher
				current={current}
				catalog={[current]}
				onSelect={(slug) => {
					selections.push(slug);
				}}
			/>,
		);
		const trigger = screen.getByRole("button", { name: "Media workspace, media" });
		fireEvent.click(trigger);

		fireEvent.click(screen.getByRole("button", { name: "Switch to Media workspace" }));

		await waitFor(() => expect(document.activeElement).toBe(trigger));
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(selections).toEqual([]);
	});

	it("restores trigger focus before selecting another workspace", async () => {
		const current = workspace();
		let triggerFocused = false;
		render(
			<WorkspaceSwitcher
				current={current}
				onSelect={() => {
					triggerFocused = document.activeElement === trigger;
				}}
				catalog={[
					current,
					workspace({
						name: "Fitness",
						slug: "fitness",
						installationId: "installation-fitness",
					}),
				]}
			/>,
		);
		const trigger = screen.getByRole("button", { name: "Media workspace, media" });
		fireEvent.click(trigger);

		fireEvent.click(screen.getByRole("button", { name: "Switch to Fitness workspace" }));

		await waitFor(() => expect(triggerFocused).toBe(true));
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("closes with Escape and restores trigger focus", async () => {
		const current = workspace();
		render(<WorkspaceSwitcher current={current} catalog={[current]} onSelect={() => undefined} />);
		const trigger = screen.getByRole("button", { name: "Media workspace, media" });
		fireEvent.click(trigger);

		fireEvent.keyDown(trigger, { key: "Escape" });

		await waitFor(() => expect(document.activeElement).toBe(trigger));
		expect(screen.queryByRole("dialog")).toBeNull();
	});
});
