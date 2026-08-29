import { describe, expect, it } from "vitest";

import {
	entityMonogram,
	fieldSyncState,
	isTitleProvisional,
	type EntitySyncState,
	type SyncStatus,
} from "./sync-state";

const sync = (
	populationStatus: SyncStatus,
	translationStatus: SyncStatus = "none",
): EntitySyncState => ({ populationStatus, translationStatus });

describe("fieldSyncState", () => {
	it("reports a present value as ready whatever the population status", () => {
		expect(fieldSyncState("Piranesi", sync("pending"))).toBe("ready");
		expect(fieldSyncState({ type: "remote" }, sync("pending"))).toBe("ready");
		expect(fieldSyncState(0, sync("none"))).toBe("ready");
		expect(fieldSyncState(false, sync("ready"))).toBe("ready");
	});

	it("reports a missing value as pending only while population is pending", () => {
		expect(fieldSyncState(null, sync("pending"))).toBe("pending");
		expect(fieldSyncState(undefined, sync("pending"))).toBe("pending");
		expect(fieldSyncState(null, sync("ready"))).toBe("absent");
		expect(fieldSyncState(undefined, sync("none"))).toBe("absent");
	});
});

describe("isTitleProvisional", () => {
	it("is true only for a pending translation", () => {
		expect(isTitleProvisional(sync("ready", "pending"))).toBe(true);
		expect(isTitleProvisional(sync("ready", "ready"))).toBe(false);
		expect(isTitleProvisional(sync("pending"))).toBe(false);
	});
});

describe("entityMonogram", () => {
	it("takes the first uppercased character and tolerates padding and astral names", () => {
		expect(entityMonogram("  piranesi ")).toBe("P");
		expect(entityMonogram("Ünsere")).toBe("Ü");
		expect(entityMonogram("🜁 sigil")).toBe("🜁");
		expect(entityMonogram("   ")).toBe("");
	});
});
