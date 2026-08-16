import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Appearance } from "#/modules/settings/appearance";
import { makeTestThemeStore } from "#/modules/theme/store.test-store";

describe("Appearance", () => {
	it("renders a labelled radiogroup with the current preference checked", () => {
		render(<Appearance theme={makeTestThemeStore("dark")} />);

		expect(screen.getByRole("radiogroup", { name: "Appearance" })).toBeTruthy();
		const light = screen.getByRole("radio", { name: "Use Light theme" });
		const dark = screen.getByRole("radio", { name: "Use Dark theme" });
		const system = screen.getByRole("radio", { name: "Use System theme" });

		expect(light.getAttribute("aria-checked")).toBe("false");
		expect(dark.getAttribute("aria-checked")).toBe("true");
		expect(system.getAttribute("aria-checked")).toBe("false");
	});

	it("selects a preference through the store and updates the checked state", () => {
		const theme = makeTestThemeStore("system");
		render(<Appearance theme={theme} />);

		fireEvent.click(screen.getByRole("radio", { name: "Use Light theme" }));

		expect(theme.getPreference()).toBe("light");
		expect(
			screen.getByRole("radio", { name: "Use Light theme" }).getAttribute("aria-checked"),
		).toBe("true");
		expect(
			screen.getByRole("radio", { name: "Use System theme" }).getAttribute("aria-checked"),
		).toBe("false");
	});
});
