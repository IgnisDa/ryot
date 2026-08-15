import type { RyotClientAdapter } from "@ryot-app/client-sdk";
import { RyotProvider } from "@ryot-app/client-sdk/react";
import { createTestRyotClock } from "@ryot-app/client-sdk/testing";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

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
		rerender: (next: ReactNode) =>
			act(() => root.render(<RyotProvider runtime={runtime}>{next}</RyotProvider>)),
		unmount: () => {
			act(() => root.unmount());
			container.remove();
			void dispose();
		},
	};
};

export const flushRyotClient = () =>
	act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
