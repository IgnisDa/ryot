import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { PageTitleProvider, usePageTitle } from "#/modules/navigation/page-title";

function Titled(props: { readonly title: string }) {
	usePageTitle(props.title);
	return null;
}

function Swap() {
	const [slug, setSlug] = useState("books");
	return (
		<>
			<Titled key={slug} title={slug === "books" ? "Books" : "Movies"} />
			<button type="button" onClick={() => setSlug("movies")}>
				navigate
			</button>
		</>
	);
}

function Interleaved() {
	const [outgoingMounted, setOutgoingMounted] = useState(true);
	return (
		<>
			{outgoingMounted && <Titled title="Outgoing" />}
			<Titled title="Incoming" />
			<button type="button" onClick={() => setOutgoingMounted(false)}>
				settle
			</button>
		</>
	);
}

function Navigating() {
	const [title, setTitle] = useState("Books");
	return (
		<>
			<Titled title={title} />
			<button type="button" onClick={() => setTitle("Movies")}>
				navigate
			</button>
		</>
	);
}

describe("PageTitleProvider", () => {
	it("appends the application name to the resolved title", () => {
		render(
			<PageTitleProvider>
				<Titled title="Account" />
			</PageTitleProvider>,
		);

		expect(document.title).toBe("Account — Ryot");
	});

	it("falls back to the application name alone when no caller registers", () => {
		render(<PageTitleProvider>{null}</PageTitleProvider>);

		expect(document.title).toBe("Ryot");
	});

	it("takes the incoming title when a route replaces another", () => {
		render(
			<PageTitleProvider>
				<Swap />
			</PageTitleProvider>,
		);
		expect(document.title).toBe("Books — Ryot");

		fireEvent.click(screen.getByRole("button", { name: "navigate" }));

		expect(document.title).toBe("Movies — Ryot");
	});

	it("keeps the live title when a stale registration is cleaned up after it", () => {
		render(
			<PageTitleProvider>
				<Interleaved />
			</PageTitleProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "settle" }));

		expect(document.title).toBe("Incoming — Ryot");
	});

	it("stays silent on first paint and announces later route changes", () => {
		render(
			<PageTitleProvider>
				<Navigating />
			</PageTitleProvider>,
		);
		expect(screen.getByTestId("route-announcer").textContent).toBe("");

		fireEvent.click(screen.getByRole("button", { name: "navigate" }));

		expect(screen.getByTestId("route-announcer").textContent).toBe("Movies");
	});
});
