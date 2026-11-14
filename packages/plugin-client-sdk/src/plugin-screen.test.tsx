import { afterEach, describe, expect, test } from "bun:test";

import { fireEvent, screen } from "@testing-library/dom";
import { it } from "@voila.dev/effect-bun-test";
import { Effect } from "effect";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

import { createPluginRouteResolver, PluginRouter } from "./navigation/routing";
import { createPluginNavigationStore } from "./navigation/store";
import { PluginScreenFrame } from "./plugin-screen";
import { RyotProvider } from "./queries/provider";
import { createTestRyotClock } from "./testing";

const roots: Root[] = [];
const clocks: Array<ReturnType<typeof createTestRyotClock>> = [];

function ViewScreen(props: {
	readonly onOpen: () => void;
	readonly activeCount: number;
	readonly onSelect: (key: string) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<PluginScreenFrame
			title="Shelf"
			menuActions={[
				{ key: "share", icon: "share", label: "Share", onSelect: () => props.onSelect("share") },
			]}
			viewOptions={{
				open,
				compactTitle: "View options",
				content: <p>Option rules</p>,
				activeCount: props.activeCount,
				onOpenChange: (next) => {
					if (next) {
						props.onOpen();
					}
					setOpen(next);
				},
			}}
		>
			<p>Shelf items</p>
		</PluginScreenFrame>
	);
}

const renderScreen = (
	options: {
		readonly compact?: boolean;
		readonly onOpen?: () => void;
		readonly activeCount?: number;
		readonly onSelect?: (key: string) => void;
	} = {},
) => {
	const shortcuts = new Map<string, () => void>();
	const store = createPluginNavigationStore(
		createPluginRouteResolver({
			routes: [{ path: "/other", component: () => <p>Other screen</p> }],
			home: {
				component: () => (
					<ViewScreen
						activeCount={options.activeCount ?? 0}
						onOpen={options.onOpen ?? (() => undefined)}
						onSelect={options.onSelect ?? (() => undefined)}
					/>
				),
			},
		}),
	);
	const clock = createTestRyotClock(
		{},
		{
			back: () => undefined,
			subscribe: store.subscribe,
			openDrawer: () => undefined,
			publishTitle: () => undefined,
			getSnapshot: store.getSnapshot,
			completeTransition: store.completeTransition,
			registerShortcut: (key, press) => {
				shortcuts.set(key, press);
				return () => {
					shortcuts.delete(key);
				};
			},
		},
	);
	clocks.push(clock);
	const navigate = (path: string, index: number) =>
		act(() => {
			store.setLocation({
				edgeBack: false,
				leading: "none",
				compact: options.compact ?? false,
				entry: { index, key: path, location: { path, search: "", kind: "route" } },
			});
		});
	navigate("/", 0);
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	roots.push(root);
	act(() =>
		root.render(
			<RyotProvider runtime={clock.runtime}>
				<PluginRouter />
			</RyotProvider>,
		),
	);
	return { navigate, shortcuts };
};

describe("PluginScreenFrame toolbar", () => {
	afterEach(() => {
		act(() => roots.splice(0).forEach((root) => root.unmount()));
		document.body.replaceChildren();
		return Effect.runPromise(
			Effect.forEach(clocks.splice(0), (clock) => Effect.promise(() => clock.dispose()), {
				discard: true,
			}),
		);
	});

	test.each([
		[0, "Filters, 0 active filters"],
		[1, "Filters, 1 active filter"],
		[3, "Filters, 3 active filters"],
	])("describes %i active filters accessibly without a visible badge", (activeCount, label) => {
		renderScreen({ activeCount });
		const button = screen.getByRole("button", { name: label });
		expect(button.textContent).toBe("Filters");
		expect(button.getAttribute("aria-keyshortcuts")).toBe("F");
	});

	it("opens the filters sheet from the F key, forwarded shortcut, and button click", () => {
		let opened = 0;
		const { shortcuts } = renderScreen({
			onOpen: () => {
				opened += 1;
			},
		});
		act(() => {
			fireEvent.keyDown(document, { key: "f" });
		});
		expect(opened).toBe(1);
		expect(screen.getByRole("dialog", { name: "Filters" }).textContent).toContain("Option rules");
		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
		});
		act(() => {
			shortcuts.get("F")?.();
		});
		expect(opened).toBe(2);
		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "Close filters" }));
		});
		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "Filters, 0 active filters" }));
		});
		expect(opened).toBe(3);
	});

	test.each(["input", "textarea"])("does not open filters while typing in %s", (tag) => {
		let opened = 0;
		renderScreen({
			onOpen: () => {
				opened += 1;
			},
		});
		const field = document.createElement(tag);
		document.body.append(field);
		field.focus();
		act(() => {
			fireEvent.keyDown(field, { key: "f" });
		});
		expect(opened).toBe(0);
	});

	it("unregisters F when its retained screen becomes inactive", () => {
		let opened = 0;
		const { navigate, shortcuts } = renderScreen({
			onOpen: () => {
				opened += 1;
			},
		});
		navigate("/other", 1);
		act(() => {
			fireEvent.keyDown(document, { key: "f" });
		});
		expect(opened).toBe(0);
		expect(shortcuts.has("F")).toBe(false);
	});

	test.each([false, true])(
		"runs overflow actions from the More actions menu (compact: %p)",
		(compact) => {
			const selected: string[] = [];
			renderScreen({ compact, onSelect: (key) => selected.push(key) });
			act(() => {
				fireEvent.click(screen.getByRole("button", { name: "More actions" }));
			});
			act(() => {
				fireEvent.click(screen.getByRole("menuitem", { name: "Share" }));
			});
			expect(selected).toEqual(["share"]);
			expect(screen.queryByRole("menu")).toBeNull();
		},
	);

	it("opens compact view options from the screen bar under the compact title", () => {
		renderScreen({ compact: true, activeCount: 2 });
		expect(screen.queryByRole("button", { name: /^Filters/ })).toBeNull();
		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "View options, 2 active filters" }));
		});
		expect(screen.getByRole("dialog", { name: "View options" }).textContent).toContain(
			"Option rules",
		);
	});
});
