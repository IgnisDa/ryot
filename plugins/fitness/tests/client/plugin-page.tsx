import { Effect } from "@ryot-app/plugin-client-sdk/effect";
import {
	mountPluginPage,
	routeLocation,
	savedViewPageContext,
} from "@ryot-app/plugin-client-sdk/testing";
import { waitFor } from "@testing-library/dom";
import type { ReactNode } from "react";

export const mountDialogInPluginPage = (render: () => ReactNode) =>
	Effect.gen(function* () {
		const page = mountPluginPage(() => <>{render()}</>, {
			location: routeLocation("/test"),
			page: savedViewPageContext({
				settings: {},
				savedViewId: "test-view",
				rendererName: "test-view",
				dataSources: { queries: {} },
			}),
		});
		yield* Effect.promise(() =>
			waitFor(() => {
				if (document.querySelector('[role="dialog"]') === null) {
					throw new Error("Expected a dialog to render");
				}
			}),
		);
		return page;
	});
