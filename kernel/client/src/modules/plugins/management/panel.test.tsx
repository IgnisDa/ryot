import { assert, expect, it } from "@effect/vitest";
import { PluginId } from "@ryot-app/contract/schema/brands";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { PluginManagementPanel } from "#/modules/plugins/management/panel";
import type { PluginManagementAction } from "#/modules/plugins/management/service";
import { managedInstallation } from "#/modules/plugins/management/service.test-fixtures";

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
	const [systemDetails, details] = view.container.querySelectorAll("details");
	assert(details);
	assert(systemDetails);
	for (const summary of view.container.querySelectorAll("summary")) {
		fireEvent.click(summary);
	}
	const row = within(details);
	expect(row.getByText("Private")).toBeDefined();
	expect(row.getByText("Incompatible")).toBeDefined();
	expect(row.getByText("private-owner")).toBeDefined();
	expect(row.getAllByText(retained.packageId)).toHaveLength(2);
	expect(row.getByText("Completed")).toBeDefined();
	expect(row.getByText("Shown")).toBeDefined();
	expect(row.getByText("package-identity-conflict")).toBeDefined();
	fireEvent.click(row.getByRole("button", { name: "Re-enable" }));
	expect(actions).toEqual([{ kind: "state", isHidden: false, installation: retained }]);
	expect(view.container.querySelector("iframe")).toBeNull();
	expect(row.getByRole("link", { name: "Back up retained data" }).getAttribute("href")).toBe(
		"/settings/backups",
	);
	const systemRow = within(systemDetails);
	expect(systemRow.getByText("System")).toBeDefined();
	expect(systemRow.getByText("Ready")).toBeDefined();
	expect(systemRow.queryByRole("button", { name: "Uninstall" })).toBeNull();
});

it("requires confirmation for exact private removal and offers no system package removal", () => {
	const installation = managedInstallation();
	const actions: PluginManagementAction[] = [];
	const view = render(
		<PluginManagementPanel
			pending={false}
			installations={[installation]}
			onAction={(action) => actions.push(action)}
		/>,
	);
	const summary = view.container.querySelector("summary");
	assert(summary);
	fireEvent.click(summary);
	fireEvent.click(screen.getByRole("button", { name: "Uninstall" }));
	expect(actions).toEqual([]);
	fireEvent.click(screen.getByRole("button", { name: "Uninstall plugin" }));
	expect(actions).toEqual([{ installation, kind: "uninstall" }]);
});
