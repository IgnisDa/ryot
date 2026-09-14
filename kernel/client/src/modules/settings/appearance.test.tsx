import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Appearance } from "#/modules/settings/appearance";
import { makeTestThemeStore } from "#/modules/theme/store.test-store";

const themeRadios = () => screen.getAllByRole("radio");

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

	it("moves the selection with the arrow, Home, and End keys", () => {
		const theme = makeTestThemeStore("light");
		render(<Appearance theme={theme} />);

		fireEvent.keyDown(screen.getByRole("radio", { name: "Use Light theme" }), {
			key: "ArrowRight",
		});
		expect(theme.getPreference()).toBe("dark");

		fireEvent.keyDown(screen.getByRole("radio", { name: "Use Dark theme" }), { key: "End" });
		expect(theme.getPreference()).toBe("system");

		fireEvent.keyDown(screen.getByRole("radio", { name: "Use System theme" }), {
			key: "ArrowRight",
		});
		expect(theme.getPreference()).toBe("light");

		fireEvent.keyDown(screen.getByRole("radio", { name: "Use Light theme" }), { key: "End" });
		fireEvent.keyDown(screen.getByRole("radio", { name: "Use System theme" }), { key: "Home" });
		expect(theme.getPreference()).toBe("light");
	});

	it("keeps a single tab stop on the checked option", () => {
		const theme = makeTestThemeStore("system");
		render(<Appearance theme={theme} />);

		expect(themeRadios().map((radio) => radio.getAttribute("tabindex"))).toEqual(["-1", "-1", "0"]);

		fireEvent.click(screen.getByRole("radio", { name: "Use Dark theme" }));

		expect(themeRadios().map((radio) => radio.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
	});
});
