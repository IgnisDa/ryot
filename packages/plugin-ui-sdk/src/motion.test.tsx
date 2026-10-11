import { describe, expect, it } from "@effect/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect } from "effect";
import { useState } from "react";

import { Dialog } from "./dialog";
import { Collapse, MotionPresence, MotionSwap } from "./motion";

function Example() {
	const [parent, setParent] = useState(false);
	const [child, setChild] = useState(false);
	return (
		<>
			<button onClick={() => setParent(true)}>Open editor</button>
			<MotionPresence>
				{parent ? (
					<Dialog
						key="editor"
						title="Editor"
						closeLabel="Close editor"
						onClose={() => setParent(false)}
					>
						<button onClick={() => setChild(true)}>Delete set</button>
					</Dialog>
				) : null}
				{child ? (
					<Dialog
						key="confirm"
						title="Confirm deletion"
						closeLabel="Cancel deletion"
						onClose={() => setChild(false)}
					>
						<button
							onClick={() => {
								setParent(false);
								setChild(false);
							}}
						>
							Confirm
						</button>
					</Dialog>
				) : null}
			</MotionPresence>
		</>
	);
}

describe("shared motion lifecycle", () => {
	it.live("replaces timer content without retaining interactive stale controls", () =>
		Effect.gen(function* () {
			const view = render(
				<MotionSwap stateKey="idle">
					<button>Idle</button>
				</MotionSwap>,
			);
			view.rerender(
				<MotionSwap stateKey="rest">
					<button>Start rest</button>
				</MotionSwap>,
			);
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.getByRole("button", { name: "Start rest" })).toBeTruthy()),
			);
			expect(screen.queryByRole("button", { name: "Idle" })).toBeNull();
		}),
	);

	it.live("makes collapsed controls inaccessible while their exit finishes", () =>
		Effect.gen(function* () {
			const view = render(
				<Collapse open>
					<button>Set options</button>
				</Collapse>,
			);
			view.rerender(
				<Collapse open={false}>
					<button>Set options</button>
				</Collapse>,
			);
			expect(screen.queryByRole("button", { name: "Set options" })).toBeNull();
			yield* Effect.promise(() =>
				waitFor(() => expect(screen.queryByText("Set options")).toBeNull()),
			);
		}),
	);

	it.live(
		"keeps the background locked through nested exits and restores the original trigger",
		() =>
			Effect.gen(function* () {
				document.body.style.overflow = "auto";
				render(<Example />);
				const trigger = screen.getByRole("button", { name: "Open editor" });
				trigger.focus();
				fireEvent.click(trigger);
				fireEvent.click(screen.getByRole("button", { name: "Delete set" }));
				fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
				expect(document.body.style.overflow).toBe("hidden");
				yield* Effect.promise(() =>
					waitFor(() => expect(document.body.style.overflow).toBe("auto")),
				);
				expect(document.activeElement).toBe(trigger);
				expect(trigger.closest("[inert]")).toBeNull();
			}),
	);
});
