import { expect } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { truncateJsonResult } from "#platform/tool-result";

import { loadAgentDocs, readAgentDocs } from "./docs";

it.layer(BunServices.layer)("agent documentation", (test) =>
	test.effect(
		"serves the execute guide and generated SDK topics in pages that fit the result budget",
		() =>
			Effect.gen(function* () {
				const topics = yield* loadAgentDocs;
				const names = topics.map(({ topic }) => topic);
				expect(names.slice(0, 2)).toEqual(["execute", "pages"]);
				expect(names).toContain("@ryot-app/plugin-client-sdk/react");
				expect(names).toContain("@ryot-app/plugin-ui-sdk/charts");
				let paginated = false;
				for (const { topic } of topics) {
					const first = yield* readAgentDocs(topics, topic);
					paginated ||= first.pages > 1;
					for (let page = 1; page <= first.pages; page += 1) {
						const read = yield* readAgentDocs(topics, topic, page);
						expect(truncateJsonResult(read).truncated).toBe(false);
					}
					const pages = first.pages;
					const beyond = yield* Effect.flip(readAgentDocs(topics, topic, pages + 1));
					expect(beyond.message).toBe(`Documentation topic ${topic} has ${pages} pages`);
				}
				expect(paginated).toBe(true);
			}),
		{ timeout: 180_000 },
	),
);
