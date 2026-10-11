import { assert, expect, it } from "@effect/vitest";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { fireEvent, render, screen, within } from "@testing-library/react";

import type { PluginManagementAction } from "./management";
import { PluginManagementPanel } from "./management-panel";
import { managedInstallation } from "./management.test-fixtures";

it("shows a retained private identity separately from the system copy without loading client code", () => {
	const retained = managedInstallation();
	const system = managedInstallation({
		scope: "system",
		health: "ready",
		healthReason: null,
		incompatibilityReason: null,
		installationId: "system-installation",
		pluginId: PluginId.make("system-owner"),
	});
	const actions: PluginManagementAction[] = [];
	const view = render(
		<PluginManagementPanel
			pending={false}
			installations={[system, retained]}
			onAction={(action) => actions.push(action)}
		/>,
	);
	const summary = screen.getByText("Whiskey · Private · test/whiskey · incompatible");
	fireEvent.click(summary);
	const details = summary.closest("details");
	assert(details);
	const row = within(details);
	expect(row.getByText("private-owner")).toBeDefined();
	expect(row.getByText(retained.packageId)).toBeDefined();
	expect(row.getByText("Completed")).toBeDefined();
	expect(row.getByText("Shown")).toBeDefined();
	expect(row.getByText("package-identity-conflict")).toBeDefined();
	fireEvent.click(row.getByRole("button", { name: "Re-enable" }));
	expect(actions).toEqual([{ kind: "state", isHidden: false, installation: retained }]);
	expect(view.container.querySelector("iframe")).toBeNull();
	expect(row.getByRole("link", { name: "Back up retained data" }).getAttribute("href")).toBe(
		"/settings/backups",
	);
	const systemSummary = screen.getByText("Whiskey · System · test/whiskey · ready");
	fireEvent.click(systemSummary);
	const systemDetails = systemSummary.closest("details");
	assert(systemDetails);
	expect(within(systemDetails).queryByRole("button", { name: "Uninstall" })).toBeNull();
});

it("requires confirmation for exact private removal and offers no system package removal", () => {
	const installation = managedInstallation();
	const actions: PluginManagementAction[] = [];
	render(
		<PluginManagementPanel
			pending={false}
			installations={[installation]}
			onAction={(action) => actions.push(action)}
		/>,
	);
	fireEvent.click(screen.getByText("Whiskey · Private · test/whiskey · incompatible"));
	fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
	expect(actions).toEqual([]);
	fireEvent.click(screen.getByRole("button", { name: "Confirm uninstall" }));
	expect(actions).toEqual([{ installation, kind: "uninstall" }]);
});
