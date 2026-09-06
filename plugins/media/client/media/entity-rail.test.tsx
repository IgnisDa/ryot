import { fireEvent } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";

import { mountRyotClient } from "../../tests/client/test-support";
import type { MediaPresentationSubject } from "./entity-presentation";
import { MediaEntityRailSection, MediaEntityTile, MediaRailFrame } from "./entity-rail";

const noopAdapter = { query: () => Promise.resolve({}) };

const subject = (id: string, name: string): MediaPresentationSubject => ({
	id,
	name,
	populationStatus: "ready",
	translationStatus: "none",
	images: [{ type: "remote", purpose: "cover", url: `https://images.test/${id}-cover.jpg` }],
});

const tileLink = (container: HTMLElement, name: string) => {
	const link = container.querySelector(`a[aria-label="Open ${name}"]`);
	if (link === null) {
		throw new Error(`Expected the tile for ${name}`);
	}
	return link;
};

afterEach(() => {
	document.body.innerHTML = "";
});

describe("MediaEntityTile", () => {
	it("draws the art override instead of the item's own poster", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<MediaEntityTile
				compact
				aspect="still"
				item={subject("show-1", "Severance")}
				art={{ type: "remote", url: "https://images.test/episode-still.jpg" }}
			/>,
		);

		expect(container.querySelector("img")?.getAttribute("src")).toBe(
			"https://images.test/episode-still.jpg",
		);
		unmount();
	});

	it("falls back to the item's poster without an art override", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<MediaEntityTile compact aspect="poster" item={subject("show-1", "Severance")} />,
		);

		expect(container.querySelector("img")?.getAttribute("src")).toBe(
			"https://images.test/show-1-cover.jpg",
		);
		unmount();
	});

	it("renders the overlay over the artwork", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<MediaEntityTile
				compact
				aspect="poster"
				overlay={<span>Next up</span>}
				item={subject("show-1", "Severance")}
			/>,
		);

		const overlay = Array.from(container.querySelectorAll("span")).find(
			(span) => span.textContent === "Next up",
		);
		expect(overlay?.parentElement?.previousElementSibling?.tagName).toBe("IMG");
		unmount();
	});
});

describe("MediaEntityRailSection", () => {
	it("sizes each tile's width from its own aspect while every artwork shares one height", () => {
		const items = [subject("movie-1", "Heat"), subject("episode-1", "Pilot")];
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<MediaEntityRailSection
				compact
				items={items}
				divided={false}
				title="Continue"
				aspect={(item) => (item.id === "episode-1" ? "still" : "poster")}
			/>,
		);

		const poster = tileLink(container, "Heat");
		const still = tileLink(container, "Pilot");
		expect(poster.classList.contains("w-28")).toBe(true);
		expect(still.classList.contains("w-74.75")).toBe(true);
		expect(poster.querySelector("img")?.classList.contains("h-42")).toBe(true);
		expect(still.querySelector("img")?.classList.contains("h-42")).toBe(true);
		unmount();
	});

	it("renders nothing without items", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<MediaEntityRailSection
				compact
				items={[]}
				divided={false}
				title="Continue"
				aspect={() => "poster"}
			/>,
		);

		expect(container.textContent).toBe("");
		unmount();
	});
});

describe("MediaRailFrame", () => {
	it("shows a loading placeholder instead of the tiles while pending", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<MediaRailFrame compact title="Continue" status={{ kind: "pending" }}>
				<span>Tile</span>
			</MediaRailFrame>,
		);

		expect(container.textContent).toContain("Continue");
		expect(container.querySelector('[role="status"]')).not.toBeNull();
		expect(container.textContent).not.toContain("Tile");
		unmount();
	});

	it("renders the tiles and the action when ready", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<MediaRailFrame
				compact
				title="Continue"
				status={{ kind: "ready" }}
				action={<span>See all</span>}
			>
				<span>Tile</span>
			</MediaRailFrame>,
		);

		expect(container.textContent).toContain("See all");
		expect(container.textContent).toContain("Tile");
		expect(container.querySelector('[role="status"]')).toBeNull();
		expect(container.querySelector('[role="alert"]')).toBeNull();
		unmount();
	});

	it("retries a failed rail through its retry callback", () => {
		let retries = 0;
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<MediaRailFrame
				compact
				title="Continue"
				status={{
					kind: "error",
					retry: () => {
						retries += 1;
					},
				}}
			>
				<span>Tile</span>
			</MediaRailFrame>,
		);

		expect(container.textContent).not.toContain("Tile");
		const retry = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Try again",
		);
		if (retry === undefined) {
			throw new Error("Expected the rail retry button");
		}
		fireEvent.click(retry);
		expect(retries).toBe(1);
		unmount();
	});
});
