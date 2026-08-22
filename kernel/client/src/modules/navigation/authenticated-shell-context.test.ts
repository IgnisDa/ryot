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
		const { header, screen } = createClientDocumentControllers(
			activeOwner,
			(state) => {
				title = state;
			},
			(state) => {
				readiness = state;
			},
		);
		const publication = { title: "Owner B", index: 2, key: "entry-b" };
		const ready = { hasPreviousScreen: true, index: 2, key: "entry-b" };

		header.activate(ownerB);
		screen.activate(ownerB);
		header.publish(ownerB, publication);
		screen.publish(ownerB, ready);
		header.publish(ownerA, { ...publication, title: "Owner A" });
		screen.publish(ownerA, { ...ready, hasPreviousScreen: false });
		screen.clear(ownerA);
		header.clear(ownerA);

		expect(title).toEqual({ owner: ownerB, ...publication });
		expect(readiness).toEqual({ owner: ownerB, ...ready });

		screen.clear(ownerB);
		header.clear(ownerB);

		expect(title).toBeNull();
		expect(readiness).toBeNull();
	});
});
