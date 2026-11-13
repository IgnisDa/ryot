import { expect } from "bun:test";

import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { truncateJsonResult } from "#platform/tool-result";

import { agentDocsTopics, readAgentDocs } from "./docs";

it.effect(
	"serves the execute guide and generated SDK topics in pages that fit the result budget",
	() =>
		Effect.gen(function* () {
			const names = agentDocsTopics.map(({ topic }) => topic);
			expect(names.slice(0, 2)).toEqual(["execute", "pages"]);
			expect(names).toContain("@ryot-app/plugin-client-sdk/react");
			expect(names).toContain("@ryot-app/plugin-ui-sdk/charts");
			let paginated = false;
			for (const { topic } of agentDocsTopics) {
				const first = yield* readAgentDocs(agentDocsTopics, topic);
				paginated ||= first.pages > 1;
				for (let page = 1; page <= first.pages; page += 1) {
					const read = yield* readAgentDocs(agentDocsTopics, topic, page);
					expect(truncateJsonResult(read).truncated).toBe(false);
				}
				const pages = first.pages;
				const beyond = yield* Effect.flip(readAgentDocs(agentDocsTopics, topic, pages + 1));
				expect(beyond.message).toBe(`Documentation topic ${topic} has ${pages} pages`);
			}
			expect(paginated).toBe(true);
		}),
);
