import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { axe } from "vitest-axe";

import { Menu } from "./menu";
import { Modal } from "./modal";
import { OverlayBackProvider, type OverlayBackAdapter } from "./shortcut";

function TriggeredModal(props: {
	readonly open?: boolean;
	readonly onClose: () => void;
	readonly onInterceptBack?: () => boolean;
}) {
	const trigger = useRef<HTMLButtonElement>(null);
	return (
		<>
			<button type="button" ref={trigger}>
				Open
			</button>
			{props.open === false ? null : (
				<Modal
					label="Confirm"
					triggerRef={trigger}
					onClose={props.onClose}
					closeLabel="Close dialog"
					onInterceptBack={props.onInterceptBack ?? (() => false)}
				>
					<button type="button">Cancel</button>
				</Modal>
			)}
		</>
	);
}

const bodyChildOf = (element: HTMLElement) =>
	Array.from(document.body.children).find((child) => child.contains(element));

function MenuInModal() {
	const trigger = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	return (
		<Modal label="Confirm" onClose={() => {}} closeLabel="Close dialog">
			<button type="button" ref={trigger} onClick={() => setOpen(true)}>
				Actions
			</button>
			{open ? (
				<Menu
					label="Actions"
					activeIndex={0}
					triggerRef={trigger}
					onActiveIndexChange={() => {}}
					onClose={() => setOpen(false)}
					items={[{ key: "rename", label: "Rename", onSelect: () => {} }]}
				/>
			) : null}
		</Modal>
	);
}

function NestedModals(props: { readonly adapter: OverlayBackAdapter }) {
	const [outerOpen, setOuterOpen] = useState(true);
	const [innerOpen, setInnerOpen] = useState(true);
	return (
		<OverlayBackProvider adapter={props.adapter}>
			{outerOpen ? (
				<Modal label="Outer" closeLabel="Close outer" onClose={() => setOuterOpen(false)}>
					<button type="button">Outer action</button>
					{innerOpen ? (
						<Modal label="Inner" closeLabel="Close inner" onClose={() => setInnerOpen(false)}>
							<button type="button">Inner action</button>
						</Modal>
					) : null}
				</Modal>
			) : null}
		</OverlayBackProvider>
	);
}

describe("Modal", () => {
	it("dismisses a nested modal before its parent on document Back", () => {
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
		render(<NestedModals adapter={adapter} />);

		act(() => expect(handlers.at(-1)?.()).toBe(true));
		expect(screen.queryByRole("dialog", { name: "Inner" })).toBeNull();
		expect(screen.getByRole("dialog", { name: "Outer" })).toBeTruthy();

		act(() => expect(handlers.at(-1)?.()).toBe(true));
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("restores trigger focus after document Back dismisses it", async () => {
		let dismiss: (() => boolean) | undefined;
		const adapter: OverlayBackAdapter = {
			register: (handler) => {
				dismiss = handler;
				return () => {
					dismiss = undefined;
				};
			},
		};
		function Page() {
			const trigger = useRef<HTMLButtonElement>(null);
			const [open, setOpen] = useState(false);
			return (
				<OverlayBackProvider adapter={adapter}>
					<button ref={trigger} type="button" onClick={() => setOpen(true)}>
						Open overlay
					</button>
					{open ? (
						<Modal
							label="Overlay"
							triggerRef={trigger}
							closeLabel="Close overlay"
							onClose={() => setOpen(false)}
						>
							<button type="button">Inside overlay</button>
						</Modal>
					) : null}
				</OverlayBackProvider>
			);
		}
		render(<Page />);
		const trigger = screen.getByRole("button", { name: "Open overlay" });
		fireEvent.click(trigger);

		act(() => expect(dismiss?.()).toBe(true));
		await act(async () => {});

		expect(screen.queryByRole("dialog")).toBeNull();
		expect(document.activeElement).toBe(trigger);
	});

	it("focuses its first control and restores focus to the trigger when it closes", async () => {
		const view = render(<TriggeredModal onClose={() => {}} />);

		expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));

		const trigger = screen.getByRole("button", { name: "Open" });
		view.rerender(<TriggeredModal open={false} onClose={() => {}} />);
		await act(async () => {});

		expect(document.activeElement).toBe(trigger);
	});

	it("focuses the dialog panel and closes on Escape when it has no interactive children", () => {
		let closes = 0;
		render(
			<Modal
				label="Information"
				closeLabel="Close dialog"
				onClose={() => {
					closes += 1;
				}}
			>
				No actions available
			</Modal>,
		);

		const dialog = screen.getByRole("dialog", { name: "Information" });
		expect(dialog.tabIndex).toBe(-1);
		expect(document.activeElement).toBe(dialog);

		fireEvent.keyDown(document, { key: "Escape" });
		expect(closes).toBe(1);
	});

	it("closes on Escape and on the scrim, and locks body scroll while open", () => {
		document.body.style.overflow = "auto";
		let closes = 0;
		const view = render(
			<TriggeredModal
				onClose={() => {
					closes += 1;
				}}
			/>,
		);
		expect(document.body.style.overflow).toBe("hidden");

		fireEvent.keyDown(document, { key: "Escape" });
		expect(closes).toBe(1);

		fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
		expect(closes).toBe(2);

		view.unmount();
		expect(document.body.style.overflow).toBe("auto");
	});

	it("closes only the topmost modal on Escape", () => {
		const closed: string[] = [];
		const view = render(
			<>
				<Modal label="Outer" closeLabel="Close outer" onClose={() => closed.push("outer")}>
					<button type="button">Outer action</button>
				</Modal>
				<Modal label="Inner" closeLabel="Close inner" onClose={() => closed.push("inner")}>
					<button type="button">Inner action</button>
				</Modal>
			</>,
		);

		fireEvent.keyDown(document, { key: "Escape" });
		expect(closed).toEqual(["inner"]);

		view.rerender(
			<Modal label="Outer" closeLabel="Close outer" onClose={() => closed.push("outer")}>
				<button type="button">Outer action</button>
			</Modal>,
		);
		fireEvent.keyDown(document, { key: "Escape" });

		expect(closed).toEqual(["inner", "outer"]);
	});

	it("skips closing when the injected back interceptor handles the request", () => {
		let closes = 0;
		let intercepts = 0;
		render(
			<TriggeredModal
				onClose={() => {
					closes += 1;
				}}
				onInterceptBack={() => {
					intercepts += 1;
					return true;
				}}
			/>,
		);

		fireEvent.keyDown(document, { key: "Escape" });

		expect(intercepts).toBe(1);
		expect(closes).toBe(0);
	});

	it("inerts the page behind it and releases it once the last modal closes", () => {
		const view = render(<TriggeredModal onClose={() => {}} />);
		const page = bodyChildOf(screen.getByRole("button", { name: "Open" }));

		expect(page?.hasAttribute("inert")).toBe(true);
		expect(bodyChildOf(screen.getByRole("dialog"))?.hasAttribute("inert")).toBe(false);

		view.rerender(<TriggeredModal open={false} onClose={() => {}} />);

		expect(page?.hasAttribute("inert")).toBe(false);
	});

	it("inerts an underlying modal while a modal is stacked over it", () => {
		const view = render(
			<>
				<Modal label="Outer" onClose={() => {}} closeLabel="Close outer">
					<button type="button">Outer action</button>
				</Modal>
				<Modal label="Inner" onClose={() => {}} closeLabel="Close inner">
					<button type="button">Inner action</button>
				</Modal>
			</>,
		);
		const outer = bodyChildOf(screen.getByRole("button", { name: "Outer action" }));
		const inner = bodyChildOf(screen.getByRole("button", { name: "Inner action" }));

		expect(outer?.hasAttribute("inert")).toBe(true);
		expect(inner?.hasAttribute("inert")).toBe(false);

		view.rerender(
			<Modal label="Outer" onClose={() => {}} closeLabel="Close outer">
				<button type="button">Outer action</button>
			</Modal>,
		);

		expect(outer?.hasAttribute("inert")).toBe(false);
	});

	it("leaves a menu opened from inside a modal reachable", () => {
		render(<MenuInModal />);

		fireEvent.click(screen.getByRole("button", { name: "Actions" }));
		const menu = screen.getByRole("menu", { name: "Actions" });

		expect(bodyChildOf(menu)?.hasAttribute("inert")).toBe(false);
		expect(screen.getByRole("menuitem", { name: "Rename" }).closest("[inert]")).toBeNull();
	});

	it("passes an axe pass on the open dialog", async () => {
		render(<TriggeredModal onClose={() => {}} />);

		const results = await axe(document.body, {
			rules: { region: { enabled: false }, "color-contrast": { enabled: false } },
		});

		expect(results.violations.map((violation) => violation.id)).toEqual([]);
	});

	it("ignores dismissal while it is not dismissible", () => {
		let closes = 0;
		render(
			<Modal
				label="Pending"
				dismissible={false}
				closeLabel="Close pending"
				onClose={() => {
					closes += 1;
				}}
			>
				<button type="button">Cancel</button>
			</Modal>,
		);

		fireEvent.keyDown(document, { key: "Escape" });
		fireEvent.click(screen.getByRole("button", { name: "Close pending" }));

		expect(closes).toBe(0);
	});
});
