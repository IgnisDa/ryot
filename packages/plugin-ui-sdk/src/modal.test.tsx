import { describe, expect } from "bun:test";

import { testText } from "@ryot-app/kernel-messages/testing";
import { testTimeout } from "@ryot-app/testing/test-timeout";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { it } from "@voila.dev/effect-bun-test";
import axe from "axe-core";
import { Effect } from "effect";
import { useRef, useState } from "react";

import { render } from "./i18n.test-support";
import { Menu } from "./menu";
import { Modal } from "./modal";
import { type OverlayBackAdapter, OverlayBackProvider } from "./shortcut";

function backHarness() {
	const handlers: Array<() => boolean> = [];
	const adapter: OverlayBackAdapter = {
		register: (handler) => {
			handlers.push(handler);
			return () => {
				handlers.splice(handlers.lastIndexOf(handler), 1);
			};
		},
	};
	return { adapter, back: () => handlers.at(-1)?.() ?? false };
}

function NestedOverlays(props: {
	readonly guarded?: boolean;
	readonly adapter: OverlayBackAdapter;
}) {
	const trigger = useRef<HTMLButtonElement>(null);
	const [outer, setOuter] = useState(false);
	const [inner, setInner] = useState(false);
	return (
		<OverlayBackProvider adapter={props.adapter}>
			<button type="button" ref={trigger} onClick={() => setOuter(true)}>
				Open editor
			</button>
			<Modal
				open={outer}
				placement="sheet"
				triggerRef={trigger}
				label={testText("Editor")}
				onClose={() => setOuter(false)}
			>
				<input aria-label="Draft" defaultValue="Preserve this" />
				<Menu
					label={testText("Actions")}
					trigger={<button type="button">Actions</button>}
					items={[{ key: "delete", label: testText("Delete"), onSelect: () => setInner(true) }]}
				/>
				<Modal
					open={inner}
					kind="alert"
					dismissible={!props.guarded}
					onClose={() => setInner(false)}
					label={testText("Delete item?")}
				>
					<button type="button" onClick={() => setInner(false)}>
						Cancel
					</button>
				</Modal>
			</Modal>
		</OverlayBackProvider>
	);
}

describe("Modal", () => {
	it.live(
		"uses Back for the top menu or confirmation and keeps a blocked draft open",
		() =>
			Effect.gen(function* () {
				const { back, adapter } = backHarness();
				const view = render(<NestedOverlays guarded adapter={adapter} />);
				const opener = screen.getByRole("button", { name: "Open editor" });
				fireEvent.click(opener);
				fireEvent.click(screen.getByRole("button", { name: "Actions" }));
				expect(screen.getByRole("menu")).toBeTruthy();

				act(() => expect(back()).toBe(true));
				expect(screen.queryByRole("menu")).toBeNull();
				expect(screen.getByRole("dialog", { name: "Editor" })).toBeTruthy();

				fireEvent.click(screen.getByRole("button", { name: "Actions" }));
				fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
				const confirmation = screen.getByRole("alertdialog", { name: "Delete item?" });
				fireEvent.keyDown(confirmation, { key: "Escape" });
				act(() => expect(back()).toBe(true));
				expect(screen.getByRole("alertdialog")).toBe(confirmation);

				view.rerender(<NestedOverlays adapter={adapter} />);
				fireEvent.keyDown(confirmation, { key: "Escape" });
				expect(screen.queryByRole("alertdialog")).toBeNull();
				expect(screen.getByRole<HTMLInputElement>("textbox", { name: "Draft" }).value).toBe(
					"Preserve this",
				);

				act(() => expect(back()).toBe(true));
				expect(screen.queryByRole("dialog")).toBeNull();
				expect(back()).toBe(false);
				yield* Effect.promise(() => waitFor(() => expect(document.activeElement).toBe(opener)));
			}),
		testTimeout,
	);

	it.live(
		"labels an open dialog and hides its background from assistive technology",
		() =>
			Effect.gen(function* () {
				render(
					<>
						<button type="button">Background action</button>
						<Modal onClose={() => {}} label={testText("Information")}>
							<p>Important information</p>
						</Modal>
					</>,
				);
				expect(screen.getByRole("dialog", { name: "Information" })).toBeTruthy();
				expect(screen.queryByRole("button", { name: "Background action" })).toBeNull();
				const results = yield* Effect.promise(() =>
					axe.run(document.body, {
						rules: { region: { enabled: false }, "color-contrast": { enabled: false } },
					}),
				);
				expect(results.violations.map((violation) => violation.id)).toEqual([]);
			}),
		testTimeout,
	);
});
