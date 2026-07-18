import { load } from "@ryot-app/sandbox-sdk/cheerio";
import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { XMLParser } from "@ryot-app/sandbox-sdk/fast-xml-parser";
import { strFromU8, gunzipSync, gzipSync } from "@ryot-app/sandbox-sdk/fflate";
import { parse } from "@ryot-app/sandbox-sdk/papaparse";
import { expect, test } from "vitest";

test("approved non-network dependencies remain local transformations", async () => {
	const encoded = new TextEncoder().encode("local");

	expect(await Effect.runPromise(Effect.succeed("local"))).toBe("local");
	expect(load("<main>local</main>")("main").text()).toBe("local");
	const compressed = gzipSync(encoded);
	expect(strFromU8(gunzipSync(compressed))).toBe("local");
	expect(Array.from(compressed.slice(4, 8))).toEqual([0, 0, 0, 0]);
	expect(Array.from(gzipSync(encoded, { mtime: 42_000 }).slice(4, 8))).toEqual([42, 0, 0, 0]);
	expect(parse("name\nlocal", { header: true }).data).toEqual([{ name: "local" }]);
	expect(new XMLParser().parse("<main>local</main>")).toEqual({ main: "local" });
});
