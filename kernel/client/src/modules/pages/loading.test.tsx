import { ScreenBarButton } from "@ryot-app/plugin-ui-sdk";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClientPageLoading } from "#/modules/pages/loading";

describe("client page loading", () => {
	it("shows a neutral interstitial before page metadata is available", () => {
		const view = render(
			<ClientPageLoading
				leading={null}
				compact={false}
				safeAreaTop={0}
				title="Opening your page"
			/>,
		);
		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		expect(screen.getByRole("heading").textContent).toBe("Opening your page");
		expect(screen.getByRole("status").textContent).toContain("Getting your view ready");
		expect(view.container.querySelector('[data-app-icon="puzzle"]')).not.toBeNull();
		expect(screen.queryByRole("button")).toBeNull();
	});

	it("keeps compact navigation available while showing the page icon", () => {
		let opened = false;
		const view = render(
			<ClientPageLoading
				compact
				safeAreaTop={24}
				icon="book-open"
				title="Opening Library"
				leading={
					<ScreenBarButton
						label="Open navigation"
						onClick={() => {
							opened = true;
						}}
					>
						Navigation
					</ScreenBarButton>
				}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
		expect(opened).toBe(true);
		expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
		expect(screen.getByRole("heading").textContent).toBe("Opening Library");
		expect(view.container.querySelector('[data-app-icon="book-open"]')).not.toBeNull();
	});
});
