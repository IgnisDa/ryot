import { useRyotViewport } from "@ryot-app/plugin-client-sdk/plugin";
import { Dialog } from "@ryot-app/plugin-ui-sdk";
import type { ComponentProps } from "react";

export function EditorSheet(
	props: Omit<ComponentProps<typeof Dialog>, "placement" | "safeAreaBottom"> & {
		readonly wide?: "center" | "side";
	},
) {
	const { compact, safeAreaBottom } = useRyotViewport();
	const { wide = "center", ...dialog } = props;
	return (
		<Dialog {...dialog} safeAreaBottom={safeAreaBottom} placement={compact ? "sheet" : wide} />
	);
}
