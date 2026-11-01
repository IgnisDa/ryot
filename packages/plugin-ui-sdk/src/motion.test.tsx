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
						<button onClick={() => setChild(true)}>Delete item</button>
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
	it.live("replaces swapped content without retaining interactive stale controls", () =>
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
	);

	it.live("makes collapsed controls inaccessible while their exit finishes", () =>
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
			yield* Effect.promise(() => waitFor(() => expect(screen.queryByText("Options")).toBeNull()));
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
				fireEvent.click(screen.getByRole("button", { name: "Delete item" }));
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
