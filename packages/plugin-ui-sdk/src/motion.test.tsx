import { describe, expect } from "bun:test";

import { testTimeout } from "@ryot-app/testing/test-timeout";
import { screen, waitFor } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";

import { render } from "./i18n.test-support";
import { Collapse, MotionSwap } from "./motion";

describe("shared motion lifecycle", () => {
	it.live(
		"replaces swapped content without retaining interactive stale controls",
		() =>
			Effect.gen(function* () {
				const view = render(
					<MotionSwap stateKey="idle">
						<button>Idle</button>
					</MotionSwap>,
				);
				view.rerender(
					<MotionSwap stateKey="rest">
						<button>Confirm</button>
					</MotionSwap>,
				);
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy()),
				);
				expect(screen.queryByRole("button", { name: "Idle" })).toBeNull();
			}),
		testTimeout,
	);

	it.live(
		"makes collapsed controls inaccessible while their exit finishes",
		() =>
			Effect.gen(function* () {
				const view = render(
					<Collapse open>
						<button>Options</button>
					</Collapse>,
				);
				view.rerender(
					<Collapse open={false}>
						<button>Options</button>
					</Collapse>,
				);
				expect(screen.queryByRole("button", { name: "Options" })).toBeNull();
				yield* Effect.promise(() =>
					waitFor(() => expect(screen.queryByText("Options")).toBeNull()),
				);
			}),
		testTimeout,
	);
});
