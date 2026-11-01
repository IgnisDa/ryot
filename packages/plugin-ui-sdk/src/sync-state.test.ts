import type { EnrichmentState, EntitySyncState } from "@ryot-app/contract/modules/entities/schemas";
import { describe, expect, it } from "vitest";

import { entityMonogram, fieldSyncState, isTitleProvisional } from "./sync-state";

const sync = (
	population: EnrichmentState["state"],
	translation: EnrichmentState["state"] = "idle",
): EntitySyncState => ({
	populationStatus: { state: population, availability: "partial" },
	translationStatus: { state: translation, availability: "missing" },
});

describe("fieldSyncState", () => {
	it("reports a present value as ready whatever the population status", () => {
		expect(fieldSyncState("Example", sync("running"))).toBe("ready");
		expect(fieldSyncState({ type: "remote" }, sync("retrying"))).toBe("ready");
		expect(fieldSyncState(0, sync("idle"))).toBe("ready");
		expect(fieldSyncState(false, sync("succeeded"))).toBe("ready");
	});

	it("reports a missing value as pending only while population is pending", () => {
		expect(fieldSyncState(null, sync("queued"))).toBe("pending");
		expect(fieldSyncState(undefined, sync("running"))).toBe("pending");
		expect(fieldSyncState(null, sync("succeeded"))).toBe("absent");
		expect(
			fieldSyncState(undefined, {
				...sync("idle"),
				populationStatus: { state: "idle", availability: "missing" },
			}),
		).toBe("absent");
		expect(fieldSyncState(null, sync("cancelled"))).toBe("absent");
	});

	it("reports a missing value as failed after a failed population", () => {
		expect(fieldSyncState(null, sync("failed"))).toBe("failed");
		expect(fieldSyncState("Example", sync("failed"))).toBe("ready");
	});
});

describe("isTitleProvisional", () => {
	it("is true only for a pending translation", () => {
		expect(isTitleProvisional(sync("succeeded", "queued"))).toBe(true);
		expect(isTitleProvisional(sync("succeeded", "running"))).toBe(true);
		expect(isTitleProvisional(sync("succeeded", "retrying"))).toBe(true);
		expect(isTitleProvisional(sync("succeeded", "succeeded"))).toBe(false);
		expect(isTitleProvisional(sync("succeeded", "failed"))).toBe(false);
		expect(isTitleProvisional(sync("running"))).toBe(false);
	});
});

describe("entityMonogram", () => {
	it("takes the first uppercased character and tolerates padding and astral names", () => {
		expect(entityMonogram("  example ")).toBe("E");
		expect(entityMonogram("Ünsere")).toBe("Ü");
		expect(entityMonogram("🜁 sigil")).toBe("🜁");
		expect(entityMonogram("   ")).toBe("");
	});
});
