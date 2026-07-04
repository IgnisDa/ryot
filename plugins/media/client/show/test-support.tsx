import { createRyotClient, type RyotClientAdapter } from "@ryot-app/client-sdk";
import { RyotProvider } from "@ryot-app/client-sdk/react";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

export const mountRyotClient = (adapter: RyotClientAdapter, children: ReactNode) => {
	const client = createRyotClient(adapter);
	const container = document.createElement("div");
	document.body.append(container);
	const root: Root = createRoot(container);
	act(() => root.render(<RyotProvider client={client}>{children}</RyotProvider>));
	return {
		client,
		container,
		rerender: (next: ReactNode) =>
			act(() => root.render(<RyotProvider client={client}>{next}</RyotProvider>)),
		unmount: () => {
			act(() => root.unmount());
			container.remove();
		},
	};
};

export const flushRyotClient = () =>
	act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
