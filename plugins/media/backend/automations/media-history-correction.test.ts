import { expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-backend-sdk/effect";
import { defineSandboxTestHost, runSandboxTestScript } from "@ryot-app/plugin-backend-sdk/testing";

import { execution } from "../../tests/backend/automations/automation-test-utils";
import definition, { manifest } from "./media-history-correction.sandbox";

const input = {
	force: true,
	conflictAttempt: 3,
	entityId: "subject",
	workKey: "older-work",
	requestKey: "request",
	liveSourceIds: ["source"],
};

it.live.each(["entity-stale", "event-stale", "event-not-found", "mutation-conflict"])(
	"yields durable continuation after repeated %s conflicts instead of failing independent work",
	(code) =>
		Effect.gen(function* () {
			let attempts = 0;
			const requests: unknown[] = [];
			const host = defineSandboxTestHost(manifest, {
				requestUserWork: (request, reference) =>
					Effect.sync(() => {
						requests.push({ request, reference });
						return { workId: "continuation" };
					}),
				executeRyotql: (document) => {
					if ("mediaLibrary" in document.queries) {
						return Effect.succeed({
							data: {
								mediaLibrary: {
									type: "rows",
									items: [{ entityId: "library" }],
									pageInfo: { limit: 2, hasMore: false, nextCursor: null },
								},
							},
						});
					}
					attempts += 1;
					return Effect.fail({ message: code, data: { code } });
				},
			});
			expect(yield* runSandboxTestScript(definition, input, host, execution)).toBeNull();
			expect(attempts).toBe(6);
			expect(requests).toHaveLength(1);
			expect(requests).toMatchObject([
				{
					reference: { referenceKind: "script", scriptSlug: "media-history-correction" },
					request: {
						scope: "subject",
						key: "subject:request:conflict:4",
						input: {
							...input,
							force: false,
							conflictAttempt: 4,
							workKey: "subject:request:conflict:4",
						},
					},
				},
			]);
		}),
);
