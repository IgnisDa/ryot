import { I18nProvider } from "@ryot-app/i18n/react";
import { testKernelRegistry } from "@ryot-app/kernel-messages/testing";
import { render as renderDom, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";

export function TestI18n(props: { readonly children: ReactNode }) {
	return (
		<I18nProvider locale="en" registry={testKernelRegistry}>
			{props.children}
		</I18nProvider>
	);
}

/** Renders with the English kernel catalog, as the kernel and plugin documents provide it. */
export const render = (ui: ReactNode, options?: Omit<RenderOptions, "wrapper">): RenderResult =>
	renderDom(ui, { ...options, wrapper: TestI18n });
