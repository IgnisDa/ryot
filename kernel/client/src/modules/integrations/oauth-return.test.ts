import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";

import {
	captureOAuthReturnFragment,
	makeOAuthReturnCapture,
} from "#/modules/integrations/oauth-return";

const makeHistory = () => {
	const replaced: { readonly state: unknown; readonly url: string }[] = [];
	const state: unknown = { key: "entry-1", __TSR_index: 0 };
	const history = {
		state,
		replaceState: (next: unknown, _unused: string, url?: string | URL | null) => {
			replaced.push({ state: next, url: String(url) });
		},
	};
	return { history, replaced };
};

const location = (pathname: string, hash: string, search = "") => ({ hash, search, pathname });

describe("OAuth return capture", () => {
	it("captures the return fragment and strips it while preserving history state", () => {
		const { history, replaced } = makeHistory();

		const captured = captureOAuthReturnFragment(
			location("/settings/oauth-return", "#connection=connection-1&secret=secret-1", "?from=a"),
			history,
		);

		expect(Option.getOrUndefined(captured)).toEqual({
			secret: "secret-1",
			connection: "connection-1",
		});
		expect(replaced).toEqual([{ state: history.state, url: "/settings/oauth-return?from=a" }]);
	});

	it("strips an undecodable fragment without capturing it", () => {
		const { history, replaced } = makeHistory();

		const captured = captureOAuthReturnFragment(
			location("/settings/oauth-return", "#connection=connection-1&status=other"),
			history,
		);

		expect(Option.isNone(captured)).toBe(true);
		expect(replaced).toEqual([{ state: history.state, url: "/settings/oauth-return" }]);
	});

	it("leaves other paths and a fragment-free return visit untouched", () => {
		const { history, replaced } = makeHistory();

		expect(
			Option.isNone(captureOAuthReturnFragment(location("/settings", "#secret=secret-1"), history)),
		).toBe(true);
		expect(
			Option.isNone(captureOAuthReturnFragment(location("/settings/oauth-return", ""), history)),
		).toBe(true);
		expect(replaced).toEqual([]);
	});

	it.effect("hands out a recorded fragment only once", () =>
		Effect.gen(function* () {
			const capture = makeOAuthReturnCapture(() => undefined);
			const { history } = makeHistory();
			yield* capture.record(
				captureOAuthReturnFragment(location("/settings/oauth-return", "#status=failed"), history),
			);

			expect(Option.getOrUndefined(yield* capture.take)).toEqual({ status: "failed" });
			expect(Option.isNone(yield* capture.take)).toBe(true);
		}),
	);
});
