import type { PluginExecutionRequest } from "@ryot-app/contract/modules/ryotql/request";
import type { RyotClientAdapter } from "@ryot-app/plugin-client-sdk";
import { DateTime, Effect } from "@ryot-app/plugin-client-sdk/effect";
import { RyotProvider } from "@ryot-app/plugin-client-sdk/react";
import {
	createTestBackgroundSubmissions,
	createTestRyotClock,
	TestI18nProvider,
} from "@ryot-app/plugin-client-sdk/testing";
import { bindTestRequest } from "@ryot-app/ryotql-recipes/test-utils";
import { fireEvent } from "@testing-library/dom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import { mediaDeclaredQueries } from "../../manifest/queries";
import { PLUGIN_PACKAGE_ID } from "../../shared/plugin-identity";
import { englishCatalog } from "../english-catalog";
import { MEDIA_OWNER_ID } from "./served-names";

type LocalDateTimeParts = {
	readonly day: number;
	readonly year: number;
	readonly month: number;
	readonly hour?: number;
	readonly minute?: number;
	readonly second?: number;
	readonly millisecond?: number;
};

export const requestQueryNames = (request: PluginExecutionRequest) => {
	const { source } = request;
	if (source.kind !== "plugin") {
		return Object.keys(bindTestRequest(request).queries);
	}
	const declared = Object.entries(mediaDeclaredQueries).find(([slug]) => slug === source.query);
	if (declared === undefined) {
		throw new Error(`Unknown declared query ${source.query}`);
	}
	return Object.keys(declared[1].document.queries);
};

export const localDateTime = (parts: LocalDateTimeParts) =>
	DateTime.makeZonedUnsafe(parts, { adjustForTimeZone: true, timeZone: DateTime.zoneMakeLocal() });

export const mediaMessages = (pluginId: string) => ({
	namespace: pluginId,
	locale: "en" as const,
	catalog: englishCatalog,
});

const withMediaMessages = (children: ReactNode) => (
	<TestI18nProvider catalogs={[mediaMessages(MEDIA_OWNER_ID)]}>{children}</TestI18nProvider>
);

export const mountRyotClient = (adapter: Partial<RyotClientAdapter>, children: ReactNode) => {
	const { client, runtime, advance, setTime, dispose } = createTestRyotClock({
		...createTestBackgroundSubmissions().adapter,
		readAccount: () =>
			Effect.succeed({
				entitlements: ["pro"],
				preferences: { weekStart: 1, timeZone: "UTC", ratingScale: "hundred" },
			}),
		pluginIdentity: (packageId) => {
			if (packageId !== PLUGIN_PACKAGE_ID) {
				throw new Error("Unexpected contributor package");
			}
			return { kind: "local", pluginId: MEDIA_OWNER_ID };
		},
		...adapter,
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root: Root = createRoot(container);
	act(() =>
		root.render(<RyotProvider runtime={runtime}>{withMediaMessages(children)}</RyotProvider>),
	);
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
			act(() =>
				root.render(<RyotProvider runtime={runtime}>{withMediaMessages(next)}</RyotProvider>),
			),
	};
};

export const flushRyotClient = () =>
	act(() =>
		Effect.runPromise(
			Effect.gen(function* () {
				yield* Effect.promise(() => Promise.resolve());
				yield* Effect.promise(() => Promise.resolve());
			}),
		),
	);

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
