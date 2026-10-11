import { expect, it } from "@effect/vitest";
import { Effect } from "@ryot-app/plugin-client-sdk/effect";

import { readEditorPages } from "./queries";

it.effect("loads editable rows beyond the first 100 without truncation", () =>
	Effect.gen(function* () {
		const requests: (string | undefined)[] = [];
		const items = yield* readEditorPages((after) =>
			Effect.sync(() => {
				requests.push(after);
				return after === undefined
					? {
							items: Array.from({ length: 100 }, (_, index) => index),
							pageInfo: { limit: 100, hasMore: true, nextCursor: "next-page" },
						}
					: { items: [100], pageInfo: { limit: 100, hasMore: false, nextCursor: null } };
			}),
		);
		expect(requests).toEqual([undefined, "next-page"]);
		expect(items).toEqual(Array.from({ length: 101 }, (_, index) => index));
	}),
);

it.effect("fails repeated cursors instead of looping or silently losing rows", () =>
	Effect.gen(function* () {
		const requests: (string | undefined)[] = [];
		const error = yield* readEditorPages((after) =>
			Effect.sync(() => {
				requests.push(after);
				return {
					items: [requests.length],
					pageInfo: { limit: 100, hasMore: true, nextCursor: "repeated" },
				};
			}),
		).pipe(Effect.flip);
		expect(error.reason).toBe("malformed-result");
		expect(requests).toEqual([undefined, "repeated"]);
	}),
);
