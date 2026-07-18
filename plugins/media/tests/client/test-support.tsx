import type { RyotClientAdapter } from "@ryot-app/client-sdk";
import { RyotProvider } from "@ryot-app/client-sdk/react";
import { createTestRyotClock } from "@ryot-app/client-sdk/testing";
import { fireEvent } from "@testing-library/dom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

declare global {
	var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export const mountRyotClient = (adapter: Partial<RyotClientAdapter>, children: ReactNode) => {
	const { client, runtime, advance, setTime, dispose } = createTestRyotClock(adapter);
	const container = document.createElement("div");
	document.body.append(container);
	const root: Root = createRoot(container);
	act(() => root.render(<RyotProvider runtime={runtime}>{children}</RyotProvider>));
	return {
		client,
		runtime,
		advance,
		setTime,
		container,
		unmount: () => {
			act(() => root.unmount());
			container.remove();
			void dispose();
		},
		rerender: (next: ReactNode) =>
			act(() => root.render(<RyotProvider runtime={runtime}>{next}</RyotProvider>)),
	};
};

export const flushRyotClient = () =>
	act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});

export const clickRyotElement = (element: Element) => {
	act(() => {
		fireEvent.click(element);
	});
};

export const pressRyotKey = (key: string) => {
	act(() => {
		fireEvent.keyDown(document, { key });
	});
};
