import type { ReactElement } from "react";
import { Drawer } from "vaul";

export function BottomSheetDialogTitle(props: { children: ReactElement }) {
	return <Drawer.Title asChild>{props.children}</Drawer.Title>;
}

export function BottomSheetDialogDescription(props: { children: ReactElement }) {
	return <Drawer.Description asChild>{props.children}</Drawer.Description>;
}
