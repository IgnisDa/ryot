import { describe, expect, it } from "bun:test";

import { fireEvent, screen } from "@testing-library/react";

import { ChipButton } from "./chips";
import { render } from "./i18n.test-support";

describe("ChipButton", () => {
	it("exposes its pressed state and runs its action", () => {
		let clicks = 0;
		render(
			<ChipButton pressed onClick={() => (clicks += 1)}>
				Owned
			</ChipButton>,
		);
		const chip = screen.getByRole("button", { name: "Owned", pressed: true });
		fireEvent.click(chip);
		expect(clicks).toBe(1);
	});
});
