import { afterEach, describe, expect, it } from "@effect/vitest";
import { fireEvent, screen } from "@testing-library/dom";
import { Effect } from "effect";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { createPluginRouteResolver, PluginRouter } from "./navigation/routing";
import { createPluginNavigationStore } from "./navigation/store";
import { ViewFiltersButton } from "./plugin-screen";
import { RyotProvider } from "./queries/provider";
import { createTestRyotClock } from "./testing";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const clocks: Array<ReturnType<typeof createTestRyotClock>> = [];

const renderButton = (activeCount: number, onClick: () => void = () => undefined) => {
	const shortcuts = new Map<string, () => void>();
	const store = createPluginNavigationStore(
		createPluginRouteResolver({
			routes: [{ path: "/other", component: () => <p>Other screen</p> }],
			home: { component: () => <ViewFiltersButton onClick={onClick} activeCount={activeCount} /> },
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
				compact: false,
				edgeBack: false,
				leading: "none",
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

describe("ViewFiltersButton", () => {
	afterEach(() => {
		act(() => roots.splice(0).forEach((root) => root.unmount()));
		document.body.replaceChildren();
		return Effect.runPromise(
			Effect.forEach(clocks.splice(0), (clock) => Effect.promise(() => clock.dispose()), {
				discard: true,
			}),
		);
	});

	it.each([
		[0, "Filters, 0 active filters"],
		[1, "Filters, 1 active filter"],
		[3, "Filters, 3 active filters"],
	])("shows %i active filters in its badge and accessible name", (count, label) => {
		renderButton(count);
		const button = screen.getByRole("button", { name: label });
		expect(button.textContent).toBe(`Filters${count}F`);
		expect(button.getAttribute("aria-keyshortcuts")).toBe("F");
	});

	it("opens filters from the F key, forwarded shortcut, and button click", () => {
		let opened = 0;
		const { shortcuts } = renderButton(0, () => {
			opened += 1;
		});
		act(() => {
			fireEvent.keyDown(document, { key: "f" });
		});
		expect(opened).toBe(1);
		act(() => {
			shortcuts.get("F")?.();
		});
		expect(opened).toBe(2);
		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "Filters, 0 active filters" }));
		});
		expect(opened).toBe(3);
	});

	it.each(["input", "textarea"])("does not open filters while typing in %s", (tag) => {
		let opened = 0;
		renderButton(0, () => {
			opened += 1;
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
		const { navigate, shortcuts } = renderButton(0, () => {
			opened += 1;
		});
		navigate("/other", 1);
		act(() => {
			fireEvent.keyDown(document, { key: "f" });
		});
		expect(opened).toBe(0);
		expect(shortcuts.has("F")).toBe(false);
	});
});
