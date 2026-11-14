import { expect, it } from "bun:test";

import { sandboxLaneCapacity } from "./queues";

it("reserves half the workers for background work, at least one", () => {
	expect(sandboxLaneCapacity(4)).toEqual({ total: 4, background: 2 });
	expect(sandboxLaneCapacity(1)).toEqual({ total: 1, background: 1 });
});
