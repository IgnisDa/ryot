import { describe, expect, it } from "vitest";

import {
	createClientDocumentControllers,
	type ClientPageScreenState,
	type PluginHeaderState,
} from "#/modules/navigation/authenticated-shell-context";

describe("active client document owner", () => {
	it("rejects title and readiness publications from the replaced document owner", () => {
		const ownerA = "plugin-page:build-1:graph-1:artifact-1";
		const ownerB = "plugin-page:build-2:graph-2:artifact-2";
		const activeOwner = { current: null as string | null };
		let title: PluginHeaderState | null = null;
		let readiness: ClientPageScreenState | null = null;
		let overlays = 0;
		const { header, screen, overlay } = createClientDocumentControllers(
			activeOwner,
			(state) => {
				title = state;
			},
			(state) => {
				readiness = state;
			},
			(count) => {
				overlays = count;
			},
		);
		const publication = { index: 2, key: "entry-b", title: "Owner B" };
		const ready = { index: 2, key: "entry-b", hasPreviousScreen: true };

		header.activate(ownerB);
		screen.activate(ownerB);
		header.publish(ownerB, publication);
		screen.publish(ownerB, ready);
		overlay.publish(ownerB, 2);
		header.publish(ownerA, { ...publication, title: "Owner A" });
		screen.publish(ownerA, { ...ready, hasPreviousScreen: false });
		overlay.publish(ownerA, 1);
		screen.clear(ownerA);
		header.clear(ownerA);

		expect(title).toEqual({ owner: ownerB, ...publication });
		expect(readiness).toEqual({ owner: ownerB, ...ready });
		expect(overlays).toBe(2);

		screen.clear(ownerB);
		overlay.clear(ownerB);
		header.clear(ownerB);

		expect(title).toBeNull();
		expect(readiness).toBeNull();
		expect(overlays).toBe(0);
	});
});
