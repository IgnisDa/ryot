import { describe, expect, it } from "@effect/vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Effect } from "effect";
import { useRef, useState } from "react";

import { DestructiveConfirmation } from "./destructive-confirmation";
import { OverlayBackProvider, type OverlayBackAdapter } from "./shortcut";

type Event = "close" | "confirm";

const createBackAdapter = () => {
	const handlers: Array<() => boolean> = [];
	const adapter: OverlayBackAdapter = {
		register: (handler) => {
			handlers.push(handler);
			return () => {
				const index = handlers.lastIndexOf(handler);
				if (index !== -1) {
					handlers.splice(index, 1);
				}
			};
		},
	};
	return { adapter, handlers };
};

function ConfirmationPage(props: {
	readonly events: Event[];
	readonly adapter: OverlayBackAdapter;
	readonly pending?: boolean;
	readonly errorMessage?: string;
	readonly confirmationPhrase?: string;
}) {
	const triggerRef = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	return (
		<OverlayBackProvider adapter={props.adapter}>
			<button type="button" ref={triggerRef} onClick={() => setOpen(true)}>
				Open confirmation
			</button>
			{open ? (
				<DestructiveConfirmation
					title="Delete item?"
					triggerRef={triggerRef}
					actionLabel="Delete item"
					pendingLabel="Deleting..."
					detail="This cannot be undone."
					pending={props.pending ?? false}
					errorMessage={props.errorMessage}
					{...(props.confirmationPhrase === undefined
						? {}
						: { confirmationPhrase: props.confirmationPhrase })}
					onConfirm={() => props.events.push("confirm")}
					onClose={() => {
						props.events.push("close");
						setOpen(false);
					}}
				/>
			) : null}
		</OverlayBackProvider>
	);
}

const openConfirmation = () =>
	fireEvent.click(screen.getByRole("button", { name: "Open confirmation" }));

describe("DestructiveConfirmation", () => {
	it("requires an exact case-sensitive and whitespace-sensitive confirmation phrase", () => {
		const events: Event[] = [];
		const { adapter } = createBackAdapter();
		render(<ConfirmationPage events={events} adapter={adapter} confirmationPhrase="Delete item" />);
		openConfirmation();

		const field = screen.getByRole("textbox", { name: 'Type "Delete item" to confirm' });
		const confirm = screen.getByRole("button", { name: "Delete item" });
		expect(confirm.hasAttribute("disabled")).toBe(true);

		fireEvent.change(field, { target: { value: "delete item" } });
		expect(confirm.hasAttribute("disabled")).toBe(true);
		fireEvent.click(confirm);

		fireEvent.change(field, { target: { value: " Delete item " } });
		expect(confirm.hasAttribute("disabled")).toBe(true);
		fireEvent.click(confirm);

		fireEvent.change(field, { target: { value: "Delete item" } });
		expect(confirm.hasAttribute("disabled")).toBe(false);
		fireEvent.click(confirm);
		expect(events).toEqual(["confirm"]);
	});

	it("focuses the confirmation field when a phrase is required", () => {
		const { adapter } = createBackAdapter();
		render(<ConfirmationPage events={[]} adapter={adapter} confirmationPhrase="DELETE" />);
		openConfirmation();

		expect(document.activeElement).toBe(
			screen.getByRole("textbox", { name: 'Type "DELETE" to confirm' }),
		);
	});

	it("locks dismissal and controls while pending", () => {
		const events: Event[] = [];
		const { adapter, handlers } = createBackAdapter();
		render(
			<ConfirmationPage pending events={events} adapter={adapter} confirmationPhrase="DELETE" />,
		);
		openConfirmation();

		expect(screen.getByRole("textbox").hasAttribute("disabled")).toBe(true);
		expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
		expect(screen.getByRole("button", { name: "Deleting..." }).hasAttribute("disabled")).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Close" }));
		fireEvent.keyDown(document, { key: "Escape" });
		act(() => expect(handlers.at(-1)?.()).toBe(false));

		expect(events).toEqual([]);
		expect(screen.getByRole("dialog", { name: "Delete item?" })).toBeTruthy();
	});

	it("announces errors", () => {
		const { adapter } = createBackAdapter();
		render(<ConfirmationPage events={[]} adapter={adapter} errorMessage="Deletion failed." />);
		openConfirmation();

		expect(screen.getByRole("alert").textContent).toBe("Deletion failed.");
	});

	it("dismisses through Escape and injected Back when not pending", () => {
		const events: Event[] = [];
		const { adapter, handlers } = createBackAdapter();
		render(<ConfirmationPage events={events} adapter={adapter} />);
		openConfirmation();

		fireEvent.keyDown(document, { key: "Escape" });
		expect(events).toEqual(["close"]);

		openConfirmation();
		act(() => expect(handlers.at(-1)?.()).toBe(true));
		expect(events).toEqual(["close", "close"]);
	});

	it.live("restores trigger focus and clears the phrase after close and reopen", () =>
		Effect.gen(function* () {
			const events: Event[] = [];
			const { adapter } = createBackAdapter();
			render(<ConfirmationPage events={events} adapter={adapter} confirmationPhrase="DELETE" />);
			const trigger = screen.getByRole("button", { name: "Open confirmation" });
			fireEvent.click(trigger);
			const field = screen.getByRole<HTMLInputElement>("textbox");
			fireEvent.change(field, { target: { value: "DELETE" } });
			fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
			yield* Effect.promise(() => act(() => Promise.resolve()));

			expect(document.activeElement).toBe(trigger);
			fireEvent.click(trigger);
			expect(screen.getByRole<HTMLInputElement>("textbox").value).toBe("");
		}),
	);

	it("needs no phrase and initially focuses Cancel when none is provided", () => {
		const events: Event[] = [];
		const { adapter } = createBackAdapter();
		render(<ConfirmationPage events={events} adapter={adapter} />);
		openConfirmation();

		expect(screen.queryByRole("textbox")).toBeNull();
		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
		const confirm = screen.getByRole("button", { name: "Delete item" });
		expect(confirm.hasAttribute("disabled")).toBe(false);
		fireEvent.click(confirm);
		expect(events).toEqual(["confirm"]);
	});
});
