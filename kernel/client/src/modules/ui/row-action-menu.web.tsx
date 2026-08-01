import { useRef, useState } from "react";
import { Pressable, useWindowDimensions, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import {
	AppMenuItemRow,
	AppMenuNote,
	rowActionMenuLabel,
	type AppMenuItem,
} from "@/modules/ui/menu-item";
import { AppModal } from "@/modules/ui/modal";

const MENU_WIDTH = 224;
const MENU_PADDING = 12;
const VIEWPORT_MARGIN = 8;
const MENU_ITEM_HEIGHT = 44;

type MenuAnchor = { readonly top: number; readonly left: number };

export function AppRowActionMenu(props: {
	readonly note?: string;
	readonly title: string;
	readonly subject: string;
	readonly items: readonly AppMenuItem[];
}) {
	const window = useWindowDimensions();
	const trigger = useRef<View>(null);
	const [anchor, setAnchor] = useState<MenuAnchor | null>(null);

	const menuHeight =
		MENU_PADDING +
		props.items.length * MENU_ITEM_HEIGHT +
		(props.note === undefined ? 0 : MENU_ITEM_HEIGHT);

	function open() {
		trigger.current?.measureInWindow((x, y, width, height) => {
			const belowTop = y + height + 4;
			setAnchor({
				left: Math.max(
					VIEWPORT_MARGIN,
					Math.min(x + width - MENU_WIDTH, window.width - MENU_WIDTH - VIEWPORT_MARGIN),
				),
				top:
					belowTop + menuHeight > window.height
						? Math.max(VIEWPORT_MARGIN, y - menuHeight - 4)
						: belowTop,
			});
		});
	}

	return (
		<View ref={trigger} collapsable={false}>
			<Pressable
				onPress={open}
				accessibilityRole="button"
				accessibilityState={{ expanded: anchor !== null }}
				accessibilityLabel={rowActionMenuLabel(props.subject)}
				className="h-11 w-11 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-accent"
			>
				<AppIcon className="text-text-muted" name="more-horizontal" size={18} />
			</Pressable>
			<AppModal
				closeLabel="Close menu"
				visible={anchor !== null}
				backdropClassName="bg-transparent"
				onClose={() => setAnchor(null)}
			>
				{anchor ? (
					<View
						accessibilityRole="menu"
						accessibilityLabel={props.title}
						style={{ top: anchor.top, left: anchor.left, width: MENU_WIDTH }}
						className="absolute gap-0.5 rounded-xl border border-border bg-surface p-1.5 shadow-card"
					>
						{props.items.map((item) => (
							<AppMenuItemRow key={item.label} item={item} onSelect={() => setAnchor(null)} />
						))}
						{props.note === undefined ? null : <AppMenuNote note={props.note} />}
					</View>
				) : null}
			</AppModal>
		</View>
	);
}
