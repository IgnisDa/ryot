import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Timeline, TimelineEntry, TimelineGroup } from "./timeline";

function Batch() {
	const [expanded, setExpanded] = useState(false);
	return (
		<Timeline>
			<TimelineGroup compact={false} label="Oct 25, 2026">
				<TimelineEntry
					title="Watched 37 episodes"
					marker={{ tone: "success" }}
					expand={{
						expanded,
						content: <p>S3·E1 · Gay Witch Hunt</p>,
						onToggle: () => setExpanded((value) => !value),
						label: expanded ? "Hide episodes" : "Show episodes",
					}}
				/>
			</TimelineGroup>
		</Timeline>
	);
}

describe("Timeline", () => {
	it("groups entries under a dated heading and toggles collapsed batches", () => {
		render(<Batch />);
		expect(screen.getByRole("heading", { name: "Oct 25, 2026" })).toBeTruthy();
		const toggle = screen.getByRole("button", { name: "Show episodes" });
		expect(toggle.getAttribute("aria-expanded")).toBe("false");

		fireEvent.click(toggle);

		expect(
			screen.getByRole("button", { name: "Hide episodes" }).getAttribute("aria-expanded"),
		).toBe("true");
		expect(screen.getByText("S3·E1 · Gay Witch Hunt")).toBeTruthy();
	});
});
