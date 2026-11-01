import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { activateLink } from "#/modules/navigation/link-activation";

const renderLink = () => {
	const activations: string[] = [];
	render(
		<a
			href="#target"
			onClick={activateLink(() => {
				activations.push("activated");
			})}
		>
			Target
		</a>,
	);
	return { activations, link: screen.getByRole("link", { name: "Target" }) };
};

describe("activateLink", () => {
	it("runs the activation and prevents default navigation on a plain left click", () => {
		const { link, activations } = renderLink();

		expect(fireEvent.click(link)).toBe(false);
		expect(activations).toEqual(["activated"]);
	});

	it.each([
		["alt", { altKey: true }],
		["ctrl", { ctrlKey: true }],
		["meta", { metaKey: true }],
		["shift", { shiftKey: true }],
		["middle button", { button: 1 }],
	])("leaves the browser to handle a %s click", (_label, init) => {
		const { link, activations } = renderLink();

		expect(fireEvent.click(link, init)).toBe(true);
		expect(activations).toEqual([]);
	});
});
