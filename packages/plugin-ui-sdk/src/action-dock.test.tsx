import { describe, expect, it } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { screen } from "@testing-library/react";

import { ActionDock } from "./action-dock";
import { render } from "./i18n.test-support";

describe("ActionDock", () => {
	it.each([
		[0, "12px"],
		[34, "42px"],
	])("labels its region and clears a %ipx bottom safe area", (safeAreaBottom, bottom) => {
		render(
			<ActionDock label={testText("Timers")} safeAreaBottom={safeAreaBottom}>
				<button type="button">Skip rest</button>
			</ActionDock>,
		);

		const dock = screen.getByRole("region", { name: "Timers" });
		expect(dock.style.bottom).toBe(bottom);
		expect(dock.contains(screen.getByRole("button", { name: "Skip rest" }))).toBe(true);
	});
});
