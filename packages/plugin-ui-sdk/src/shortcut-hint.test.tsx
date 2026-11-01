import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ShortcutHint } from "./shortcut-hint";

describe("ShortcutHint", () => {
	it("renders Command and Shift icons on macOS in one decorative keycap", () => {
		render(
			<HotkeysProvider defaultOptions={{ hotkey: { platform: "mac" } }}>
				<ShortcutHint shortcut="Mod+Shift+Space" />
			</HotkeysProvider>,
		);

		const hint = screen.getByText("Space");
		expect(hint.tagName).toBe("KBD");
		expect(hint.getAttribute("aria-hidden")).toBe("true");
		expect(
			Array.from(hint.querySelectorAll("svg"), (icon) => icon.getAttribute("data-app-icon")),
		).toEqual(["command", "arrow-big-up"]);
	});

	it.each(["windows", "linux"] as const)("renders Ctrl instead of Command on %s", (platform) => {
		render(
			<HotkeysProvider defaultOptions={{ hotkey: { platform } }}>
				<ShortcutHint shortcut="Mod+Shift+Space" />
			</HotkeysProvider>,
		);

		const hint = screen.getByText("Space");
		expect(hint.contains(screen.getByText("Ctrl"))).toBe(true);
		expect(
			Array.from(hint.querySelectorAll("svg"), (icon) => icon.getAttribute("data-app-icon")),
		).toEqual(["arrow-big-up"]);
	});

	it("keeps letter and punctuation keys as text", () => {
		render(
			<>
				<ShortcutHint shortcut="/" />
				<ShortcutHint onAccent shortcut="A" className="ml-1" />
			</>,
		);

		expect(screen.getByText("/").querySelector("svg")).toBeNull();
		const accentHint = screen.getByText("A");
		expect(accentHint.querySelector("svg")).toBeNull();
		expect(accentHint.classList.contains("text-accent-ink")).toBe(true);
		expect(accentHint.classList.contains("ml-1")).toBe(true);
	});
});
