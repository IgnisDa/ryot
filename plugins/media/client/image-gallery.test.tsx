import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { MediaImage } from "../shared/media-image";
import { emptyShowOverview } from "../tests/client/show/overview-fixture";
import { decodeShowSummary } from "../tests/client/show/summary-fixture";
import { clickRyotElement, mountRyotClient, pressRyotKey } from "../tests/client/test-support";
import { MediaImageGallery } from "./image-gallery";
import { galleryImages } from "./image-gallery-state";
import { ShowOverview } from "./show/overview";

const noopAdapter = { query: () => Promise.resolve({}) };

const remote = (index: number, purpose: MediaImage["purpose"]): MediaImage => ({
	purpose,
	type: "remote",
	url: `https://images.test/${index}.jpg`,
});

const twelveImages = [
	...Array.from({ length: 9 }, (_, index) => remote(index, "backdrop")),
	remote(9, "cover"),
	remote(10, "cover"),
	remote(11, "logo"),
];

const dialog = (name: string) => {
	const found = Array.from(document.body.querySelectorAll('[role="dialog"]')).find(
		(element) => element.getAttribute("aria-label") === name,
	);
	if (found === undefined) {
		throw new Error(`Expected a dialog labelled ${name}`);
	}
	return found;
};

const tiles = () =>
	Array.from(dialog("Dark images").querySelectorAll<HTMLElement>('[aria-label^="View image"]'));

const tile = (index: number) => {
	const found = tiles()[index];
	if (found === undefined) {
		throw new Error(`Expected a tile at ${index}`);
	}
	return found;
};

const railImages = (container: HTMLElement) => {
	const section = Array.from(container.querySelectorAll("section")).find(
		(element) => element.querySelector("h2")?.textContent === "Images",
	);
	if (section === undefined) {
		throw new Error("Expected the Images section");
	}
	return section.querySelectorAll("img");
};

const chip = (label: string) => {
	const found = Array.from(dialog("Dark images").querySelectorAll('[role="radio"]')).find(
		(element) => element.textContent.startsWith(label),
	);
	if (found === undefined) {
		throw new Error(`Expected a ${label} chip`);
	}
	return found;
};

const mountGallery = (compact: boolean) =>
	mountRyotClient(
		noopAdapter,
		<MediaImageGallery
			name="Dark"
			compact={compact}
			triggerRef={createRef()}
			onClose={() => undefined}
			images={galleryImages(twelveImages)}
		/>,
	);

afterEach(() => {
	document.body.innerHTML = "";
});

describe("MediaImageGallery", () => {
	it("opens from the overview button and shows every image, not the rail's ten", () => {
		const { unmount, container } = mountRyotClient(
			noopAdapter,
			<ShowOverview
				compact
				refreshOverview={() => undefined}
				overview={{ status: "ready", overview: emptyShowOverview() }}
				show={decodeShowSummary({ name: "Dark", images: twelveImages })}
			/>,
		);

		expect(railImages(container)).toHaveLength(10);

		const trigger = Array.from(container.querySelectorAll("button")).find(
			(element) => element.textContent === "View all images",
		);
		if (trigger === undefined) {
			throw new Error("Expected the View all images button");
		}
		clickRyotElement(trigger);

		expect(tiles()).toHaveLength(12);
		expect(dialog("Dark images").textContent).toContain("12 images");
		unmount();
	});

	it("narrows the grid to the selected purpose", () => {
		const { unmount } = mountGallery(true);

		expect(tiles()).toHaveLength(12);

		clickRyotElement(chip("Covers"));

		expect(tiles()).toHaveLength(2);
		expect(dialog("Dark images").textContent).toContain("2 images");
		unmount();
	});

	it("opens the lightbox on the tile that was clicked", () => {
		const { unmount } = mountGallery(true);

		clickRyotElement(tile(2));

		expect(dialog("Image 3 of 12").textContent).toContain("3 / 12");
		unmount();
	});

	it("pages with the arrow keys and stops at both ends", () => {
		const { unmount } = mountGallery(false);

		clickRyotElement(tile(0));
		expect(dialog("Image 1 of 12").textContent).toContain("1 / 12");

		pressRyotKey("ArrowLeft");
		expect(dialog("Image 1 of 12").textContent).toContain("1 / 12");

		pressRyotKey("ArrowRight");
		expect(dialog("Image 2 of 12").textContent).toContain("2 / 12");

		pressRyotKey("End");
		expect(dialog("Image 12 of 12").textContent).toContain("12 / 12");

		pressRyotKey("ArrowRight");
		expect(dialog("Image 12 of 12").textContent).toContain("12 / 12");
		unmount();
	});

	it("pages only within the active filter", () => {
		const { unmount } = mountGallery(false);

		clickRyotElement(chip("Covers"));
		clickRyotElement(tile(0));

		expect(dialog("Image 1 of 2").textContent).toContain("1 / 2");
		unmount();
	});

	it("returns focus to the tile the lightbox was opened from", async () => {
		const { unmount } = mountGallery(true);
		const opened = tile(4);

		clickRyotElement(opened);
		pressRyotKey("Escape");
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(document.activeElement).toBe(opened);
		unmount();
	});
});
