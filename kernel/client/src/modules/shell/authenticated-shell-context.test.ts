import { describe, expect, it } from "vitest";

import {
	createClientPagePresentationController,
	emptyClientPagePresentation,
} from "#/modules/shell/authenticated-shell-context";

const entry = { index: 2, key: "entry-b" };
const header = { ...entry, title: "Owner B" };
const readiness = { ...entry, hasPreviousScreen: true };

function presentationHarness() {
	const states = [emptyClientPagePresentation];
	const controller = createClientPagePresentationController(entry, (state) => {
		states.push(state);
	});
	return { states, controller, current: () => states.at(-1) };
}

describe("active client document presentation", () => {
	it("resets every field together on activation and rejects departing-owner work", () => {
		const { states, current, controller } = presentationHarness();
		controller.activate("owner-a");
		controller.publishHeader("owner-a", header);
		controller.publishReadiness("owner-a", readiness);
		controller.publishOverlayCount("owner-a", 2);

		const beforeActivation = states.length;
		controller.activate("owner-b");
		expect(states.length).toBe(beforeActivation + 1);
		expect(current()).toEqual({ ...emptyClientPagePresentation, owner: "owner-b" });

		controller.publishHeader("owner-b", header);
		controller.publishReadiness("owner-b", readiness);
		controller.publishOverlayCount("owner-b", 3);
		const beforeStaleWork = states.length;
		controller.publishHeader("owner-a", { ...header, title: "Owner A" });
		controller.publishReadiness("owner-a", null);
		controller.publishReadiness("owner-a", { ...readiness, hasPreviousScreen: false });
		controller.publishOverlayCount("owner-a", 1);
		controller.deactivate("owner-a");
		expect(states.length).toBe(beforeStaleWork);
		expect(current()).toEqual({ header, readiness, overlayCount: 3, owner: "owner-b" });
	});

	it("deactivates all fields together and immediately rejects further publications", () => {
		const { states, current, controller } = presentationHarness();
		controller.activate("owner");
		controller.publishHeader("owner", header);
		controller.publishReadiness("owner", readiness);
		controller.publishOverlayCount("owner", 2);
		const beforeDeactivation = states.length;
		controller.deactivate("owner");
		expect(states.length).toBe(beforeDeactivation + 1);
		expect(current()).toEqual(emptyClientPagePresentation);

		controller.publishHeader("owner", header);
		controller.publishReadiness("owner", readiness);
		controller.publishOverlayCount("owner", 1);
		controller.deactivate("owner");
		expect(states.length).toBe(beforeDeactivation + 1);
	});

	it.each([
		{ ...entry, index: 3 },
		{ ...entry, key: "entry-c" },
	])(
		"resets entry-scoped fields in a retained frame and rejects stale entry $index/$key",
		(nextEntry) => {
			const { states, current, controller } = presentationHarness();
			controller.activate("retained-frame");
			controller.publishHeader("retained-frame", header);
			controller.publishReadiness("retained-frame", readiness);
			controller.publishOverlayCount("retained-frame", 2);

			controller.setEntry(nextEntry);
			expect(current()).toEqual({
				header: null,
				readiness: null,
				overlayCount: 2,
				owner: "retained-frame",
			});
			const nextHeader = { ...nextEntry, title: "Next screen" };
			const nextReadiness = { ...nextEntry, hasPreviousScreen: false };
			controller.publishHeader("retained-frame", nextHeader);
			controller.publishReadiness("retained-frame", nextReadiness);
			const beforeStaleWork = states.length;
			controller.publishHeader("retained-frame", header);
			controller.publishReadiness("retained-frame", readiness);
			expect(states.length).toBe(beforeStaleWork);
			expect(current()).toEqual({
				overlayCount: 2,
				header: nextHeader,
				owner: "retained-frame",
				readiness: nextReadiness,
			});
		},
	);

	it("retains publications for page-state replacement and clears each publication independently", () => {
		const { states, current, controller } = presentationHarness();
		controller.activate("owner");
		controller.publishHeader("owner", header);
		controller.publishReadiness("owner", readiness);
		controller.publishOverlayCount("owner", 2);
		const beforeEntry = states.length;
		controller.setEntry({ ...entry });
		expect(states.length).toBe(beforeEntry);
		expect(current()).toEqual({ header, readiness, owner: "owner", overlayCount: 2 });

		controller.publishReadiness("owner", null);
		expect(current()).toEqual({ header, owner: "owner", readiness: null, overlayCount: 2 });
		controller.publishHeader("owner", { ...header, title: null });
		expect(current()).toEqual({
			owner: "owner",
			readiness: null,
			overlayCount: 2,
			header: { ...header, title: null },
		});
		controller.publishOverlayCount("owner", 0);
		expect(current()?.overlayCount).toBe(0);
	});

	it("starts a fresh presentation when a frame is reactivated", () => {
		const { current, controller } = presentationHarness();
		controller.activate("retained-frame");
		controller.publishHeader("retained-frame", header);
		controller.publishReadiness("retained-frame", readiness);
		controller.publishOverlayCount("retained-frame", 2);
		controller.deactivate("retained-frame");
		controller.activate("retained-frame");
		expect(current()).toEqual({ ...emptyClientPagePresentation, owner: "retained-frame" });
	});
});
