import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EntityArtWell } from "./sync";

const artWell = (state: "pending" | "failed" | "absent") =>
	render(<EntityArtWell state={state} url={undefined} className="art" monogram="piranesi" />)
		.container;

describe("EntityArtWell", () => {
	it("shimmers with a populating pip while population is pending", () => {
		const well = artWell("pending");

		expect(well.querySelector(".animate-sync-sweep")).not.toBeNull();
		expect(well.querySelector(".animate-sync-pulse")).not.toBeNull();
	});

	it("shows the plain monogram without a pip or shimmer after a failed population", () => {
		const failed = artWell("failed");

		expect(failed.textContent).toBe("P");
		expect(failed.querySelector(".animate-sync-sweep")).toBeNull();
		expect(failed.querySelector(".animate-sync-pulse")).toBeNull();
		expect(failed.innerHTML).toBe(artWell("absent").innerHTML);
	});
});
