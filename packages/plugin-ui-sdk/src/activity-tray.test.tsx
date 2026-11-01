import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ActivityTray } from "./activity-tray";

describe("ActivityTray", () => {
	it("renders attributed entries as text with one polite announcement region", () => {
		const calls: string[] = [];
		render(
			<ActivityTray
				compact={false}
				dismissIcon="×"
				safeAreaBottom={0}
				label="Background activity"
				announcement="Media: Logged episode 3 saved"
				entries={[
					{
						id: "a",
						tone: "error",
						source: "Media",
						title: "<img src=x onerror=alert(1)>",
						onDismiss: () => calls.push("dismiss"),
						status: "Couldn't confirm this was saved.",
						action: { label: "Retry", onClick: () => calls.push("retry") },
					},
					{ id: "b", tone: "pending", title: "Weight", source: "Fitness", status: "Saving…" },
				]}
			/>,
		);

		const tray = screen.getByRole("region", { name: "Background activity" });
		expect(tray.querySelector("img")).toBeNull();
		const entry = within(tray).getByRole("article", {
			name: "Media: <img src=x onerror=alert(1)>",
		});
		expect(within(entry).getByText("<img src=x onerror=alert(1)>")).toBeDefined();
		expect(within(entry).getByText("Media")).toBeDefined();
		fireEvent.click(within(entry).getByRole("button", { name: "Retry" }));
		fireEvent.click(
			within(entry).getByRole("button", { name: "Dismiss <img src=x onerror=alert(1)>" }),
		);
		expect(calls).toEqual(["retry", "dismiss"]);

		const pending = within(tray).getByRole("article", { name: "Fitness: Weight" });
		expect(within(pending).queryAllByRole("button")).toEqual([]);

		const live = tray.querySelectorAll("[aria-live]");
		expect(live).toHaveLength(1);
		expect(live[0]?.getAttribute("aria-live")).toBe("polite");
		expect(live[0]?.textContent).toBe("Media: Logged episode 3 saved");
	});

	it("anchors a compact tray above the bottom safe area", () => {
		render(
			<ActivityTray
				compact
				entries={[]}
				dismissIcon="×"
				announcement=""
				safeAreaBottom={34}
				label="Background activity"
			/>,
		);
		const tray = screen.getByRole("region", { name: "Background activity" });
		expect(tray.style.paddingBottom).toBe("46px");
	});
});
