import { expect, it } from "@effect/vitest";
import { Result } from "effect";

import { selectSnapshotTier } from "./snapshot-tier";

it("routes imports to the smallest snapshot tier that covers them", () => {
	const core = "@ryot-app/sandbox-sdk/effect";
	const data = "@ryot-app/sandbox-sdk/cheerio";
	const full = "@ryot-app/sandbox-sdk/youtubei";

	expect(selectSnapshotTier([])).toEqual(Result.succeed("core"));
	expect(selectSnapshotTier([core, "effect"])).toEqual(Result.succeed("core"));
	expect(selectSnapshotTier([core, data])).toEqual(Result.succeed("data"));
	expect(selectSnapshotTier([data, full, core])).toEqual(Result.succeed("full"));

	const unknown = selectSnapshotTier([core, "unknown", "cheerio"]);
	expect(Result.isFailure(unknown) && unknown.failure.imports).toEqual(["unknown", "cheerio"]);
});
