import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ArtTile } from "./art-tile";

describe("ArtTile", () => {
	it("announces progress with its label and renders optional badge and lines", () => {
		render(
			<ArtTile
				badge="Ep 199"
				aspect="poster"
				art={<img alt="" />}
				title="99% Invisible"
				lines={["Audio Guide"]}
				progress={{ max: 100, value: 20, label: "20% complete" }}
			/>,
		);
		const progress = screen.getByRole("progressbar", { name: "20% complete" });
		expect(progress.getAttribute("aria-valuenow")).toBe("20");
		expect(screen.getByText("Ep 199")).toBeTruthy();
		expect(screen.getByText("Audio Guide")).toBeTruthy();
	});
});
