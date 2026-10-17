import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatStrip } from "./stat-strip";

describe("StatStrip", () => {
	it("pairs each value with its label as a description list", () => {
		render(
			<StatStrip
				compact={false}
				stats={[
					{ value: "3", key: "finished", label: "Finished" },
					{ key: "span", label: "Span", value: "189 days", detail: "Dec 8 – Jun 13" },
				]}
			/>,
		);
		const terms = screen.getAllByRole("term").map((term) => term.textContent);
		const definitions = screen.getAllByRole("definition").map((value) => value.textContent);
		expect(terms).toEqual(["Finished", "Span"]);
		expect(definitions).toEqual(["3", "189 days", "Dec 8 – Jun 13"]);
	});
});
