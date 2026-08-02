import type { EntityUpdatedFrame } from "@ryot/contract/modules/entity-interest/messages";
import { describe, expect, it } from "vitest";

import { EntityInterestCoordinator } from "./coordinator";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("entity-interest coordinator", () => {
	it("declares the union and removes unmounted owners", async () => {
		const declarations: string[][] = [];
		const coordinator = new EntityInterestCoordinator((_streamId, entityIds) => {
			declarations.push([...entityIds]);
			return Promise.resolve([]);
		});
		const removeA = coordinator.setInterest("a", ["entity-1", "entity-2"]);
		coordinator.setInterest("b", ["entity-2", "entity-3"]);
		coordinator.setConnection("stream-1");
		await tick();

		expect(declarations.at(-1)).toEqual(["entity-1", "entity-2", "entity-3"]);

		removeA();
		await tick();
		expect(declarations.at(-1)).toEqual(["entity-2", "entity-3"]);
	});

	it("publishes terminal and stream updates and redeclares only after streamed population", async () => {
		const declarations: string[][] = [];
		const updates: EntityUpdatedFrame[] = [];
		const terminal = { entityId: "entity-1", reason: "populated" } as const;
		const coordinator = new EntityInterestCoordinator((_streamId, entityIds) => {
			declarations.push([...entityIds]);
			return Promise.resolve(declarations.length === 1 ? [terminal] : []);
		});
		coordinator.subscribe((frame) => updates.push(frame));
		coordinator.setInterest("surface", ["entity-1"]);
		coordinator.setConnection("stream-1");
		await tick();

		expect(declarations).toHaveLength(1);
		expect(updates).toEqual([terminal]);

		coordinator.receive(terminal);
		await tick();
		expect(declarations).toHaveLength(2);
		expect(updates).toEqual([terminal, terminal]);
	});

	it("coalesces interest changes made during a declaration", async () => {
		const declarations: string[][] = [];
		let releaseFirst: (() => void) | undefined;
		const first = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const coordinator = new EntityInterestCoordinator(async (_streamId, entityIds) => {
			declarations.push([...entityIds]);
			if (declarations.length === 1) {
				await first;
			}
			return [];
		});
		coordinator.setInterest("surface", ["entity-1"]);
		coordinator.setConnection("stream-1");
		await tick();
		coordinator.setInterest("surface", ["entity-2"]);
		releaseFirst?.();
		await tick();

		expect(declarations).toEqual([["entity-1"], ["entity-2"]]);
	});
});
