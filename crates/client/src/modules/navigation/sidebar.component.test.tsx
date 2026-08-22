import { describe, expect, it } from "@jest/globals";
import type { NavigationWorkspace } from "@ryot/ryotql-recipes/navigation";
import { render, screen } from "@testing-library/react-native";

import type { NavigationItems } from "./navigation-data";
import { Sidebar } from "./sidebar";

const workspace: NavigationWorkspace = {
	sortOrder: 1,
	slug: "media",
	name: "Media",
	isDisabled: false,
	icon: "clapperboard",
};

const items: NavigationItems = { views: [], savedViews: [], collections: [] };

const baseProps = {
	items,
	workspace,
	activeKey: "home",
	accountImage: null,
	className: "flex-1",
	accountName: "Ada Lovelace",
	onNavigate: () => undefined,
	accountEmail: "ada@example.com",
	onOpenSettings: () => undefined,
	onWorkspaceOpen: () => undefined,
};

describe("sidebar", () => {
	it("crowns the account avatar for a Pro instance", async () => {
		await render(<Sidebar {...baseProps} isPro />);

		expect(screen.getByLabelText("Ryot Pro")).toBeOnTheScreen();
	});

	it("leaves the account avatar plain on a community instance", async () => {
		await render(<Sidebar {...baseProps} isPro={false} />);

		expect(screen.queryByLabelText("Ryot Pro")).not.toBeOnTheScreen();
	});
});
