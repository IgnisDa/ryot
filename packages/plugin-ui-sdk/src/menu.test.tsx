import { describe, expect, it } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { fireEvent, screen } from "@testing-library/react";

import { render } from "./i18n.test-support";
import { Menu } from "./menu";

describe("Menu", () => {
	it("opens a shared action menu with labelled and disabled items", () => {
		const selected: string[] = [];
		render(
			<Menu
				label={testText("Actions")}
				trigger={<button type="button">Actions</button>}
				items={[
					{
						key: "share",
						icon: "share",
						label: testText("Share"),
						onSelect: () => selected.push("share"),
					},
					{
						key: "delete",
						disabled: true,
						label: testText("Delete"),
						onSelect: () => selected.push("delete"),
					},
				]}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Actions" }));
		const share = screen.getByRole("menuitem", { name: "Share" });
		const remove = screen.getByRole("menuitem", { name: "Delete" });
		expect(share.querySelector("[data-app-icon]")).not.toBeNull();
		expect(remove.getAttribute("aria-disabled")).toBe("true");

		fireEvent.click(remove);
		expect(selected).toEqual([]);
		fireEvent.click(share);
		expect(selected).toEqual(["share"]);
		expect(screen.queryByRole("menu")).toBeNull();
	});
});
