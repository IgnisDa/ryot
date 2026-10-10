import { Effect } from "@ryot-app/sandbox-sdk/effect";
import { defineSandboxTestHost } from "@ryot-app/sandbox-sdk/testing";
import { expect, it } from "vitest";

import { manifest } from "../../providers/pokemon/pokeapi/search.sandbox";
import { loadJson } from "./pokeapi";

it("maps invalid PokeAPI JSON to a typed failure", () => {
	const host = defineSandboxTestHost(manifest, {
		httpCall: () => Effect.succeed({ body: "{", status: 200, headers: {} }),
	});
	return expect(
		Effect.runPromise(loadJson(host, "https://pokeapi.co/broken")),
	).rejects.toMatchObject({
		_tag: "PokeApiError",
		message: "PokeAPI returned invalid JSON: https://pokeapi.co/broken",
	});
});
