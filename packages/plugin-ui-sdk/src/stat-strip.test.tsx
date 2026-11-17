import { describe, expect, it } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { screen } from "@testing-library/react";

import { render } from "./i18n.test-support";
import { StatStrip } from "./stat-strip";

describe("StatStrip", () => {
	it("pairs each value with its label as a description list", () => {
		render(
			<StatStrip
				compact={false}
				stats={[
					{ value: "3", key: "finished", label: testText("Finished") },
					{ key: "span", value: "189 days", label: testText("Span"), detail: "Dec 8 – Jun 13" },
				]}
			/>,
		);
		const terms = screen.getAllByRole("term").map((term) => term.textContent);
		const definitions = screen.getAllByRole("definition").map((value) => value.textContent);
		expect(terms).toEqual(["Finished", "Span"]);
		expect(definitions).toEqual(["3", "189 days", "Dec 8 – Jun 13"]);
	});
});
