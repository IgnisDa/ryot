/* oxlint-disable perfectionist/sort-jsx-props -- Keep each viewport fixture grouped. */
import { StyleXTracerPanel } from "@ryot-app/client-ui-sdk/stylex-tracer";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("StyleX tracer route panel", () => {
	it("preserves state across theme and viewport changes and cleans up its modal portal", async () => {
		const background = document.createElement("div");
		const portalRoot = document.createElement("div");
		document.body.append(background);
		document.body.append(portalRoot);
		const view = render(
			<StyleXTracerPanel
				compact={false}
				safeAreaTop={13}
				safeAreaBottom={17}
				resolvedTheme="light"
				portalRoot={portalRoot}
			/>,
		);

		const panel = screen.getByTestId("stylex-tracer-panel");
		expect(panel.dataset.layout).toBe("wide");
		expect(panel.getAttribute("style")).toContain("37px");
		expect(panel.getAttribute("style")).toContain("41px");
		expect(portalRoot.dataset.stylexTracerTheme).toBe("light");
		fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
			target: { value: "Tracer" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Advance progress" }));
		fireEvent.click(screen.getByRole("button", { name: "Details" }));
		const details = within(portalRoot).getByRole("dialog", { name: "Tracer details" });
		const lightDetailsClass = details.className;
		const close = within(details).getByRole("button", { name: "Close details" });
		expect(details.getAttribute("aria-modal")).toBe("true");
		expect(document.activeElement).toBe(close);
		expect(background.hasAttribute("inert")).toBe(true);
		expect(document.body.style.overflow).toBe("hidden");
		expect(fireEvent.keyDown(close, { key: "Tab" })).toBe(false);
		expect(document.activeElement).toBe(close);
		expect(fireEvent.keyDown(close, { key: "Tab", shiftKey: true })).toBe(false);
		expect(document.activeElement).toBe(close);
		expect(details.textContent).toContain("Name: Tracer");
		expect(details.textContent).toContain("Progress: 42%");

		view.rerender(
			<StyleXTracerPanel
				compact
				safeAreaTop={21}
				safeAreaBottom={34}
				resolvedTheme="dark"
				portalRoot={portalRoot}
			/>,
		);

		const field = screen.getByRole("textbox", { name: "Name" });
		expect(field).toBeInstanceOf(HTMLInputElement);
		if (!(field instanceof HTMLInputElement)) {
			throw new TypeError("Expected the Name control to be an input");
		}
		expect(field.value).toBe("Tracer");
		expect(
			screen.getByRole("progressbar", { name: "Tracer progress" }).getAttribute("aria-valuenow"),
		).toBe("42");
		expect(panel.dataset.layout).toBe("compact");
		expect(panel.getAttribute("style")).toContain("45px");
		expect(panel.getAttribute("style")).toContain("58px");
		expect(portalRoot.dataset.stylexTracerTheme).toBe("dark");
		expect(within(portalRoot).getByRole("dialog")).toBe(details);
		expect(details.className).not.toBe(lightDetailsClass);

		fireEvent.keyDown(document, { key: "Escape" });
		expect(within(portalRoot).queryByRole("dialog")).toBeNull();
		expect(background.hasAttribute("inert")).toBe(false);
		expect(document.body.style.overflow).toBe("");
		await waitFor(() =>
			expect(document.activeElement).toBe(screen.getByRole("button", { name: "Details" })),
		);

		view.unmount();
		expect(portalRoot.dataset.stylexTracerTheme).toBeUndefined();
		expect(portalRoot.className).toBe("");
		expect(portalRoot.childElementCount).toBe(0);
		portalRoot.remove();
		background.remove();
	});

	it("reports an empty name and disables progress until reset", () => {
		const portalRoot = document.createElement("div");
		document.body.append(portalRoot);
		const view = render(
			<StyleXTracerPanel
				compact
				safeAreaTop={0}
				safeAreaBottom={0}
				resolvedTheme="light"
				portalRoot={portalRoot}
			/>,
		);

		const field = screen.getByRole("textbox", { name: "Name" });
		expect(field).toBeInstanceOf(HTMLInputElement);
		if (!(field instanceof HTMLInputElement)) {
			throw new TypeError("Expected the Name control to be an input");
		}
		expect(field.placeholder).toBe("Enter a name");
		field.focus();
		expect(document.activeElement).toBe(field);
		fireEvent.change(field, { target: { value: "" } });
		expect(field.getAttribute("aria-invalid")).toBe("true");
		expect(screen.getByRole("alert").textContent).toBe("Name is required.");
		const advance = screen.getByRole("button", { name: "Advance progress" });
		expect(advance).toBeInstanceOf(HTMLButtonElement);
		expect(advance.getAttribute("disabled")).not.toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Reset" }));
		expect(field.value).toBe("Ryot");
		expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("35");
		view.unmount();
		portalRoot.remove();
	});
});
