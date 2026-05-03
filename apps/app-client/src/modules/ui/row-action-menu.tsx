import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppIcon } from "@/modules/icons";
import { BottomSheet } from "@/modules/ui/bottom-sheet";
import {
	AppMenuItemRow,
	AppMenuNote,
	rowActionMenuLabel,
	type AppMenuItem,
} from "@/modules/ui/menu-item";

const SHEET_CHROME_HEIGHT = 120;
const SHEET_ITEM_HEIGHT = 48;

export function AppRowActionMenu(props: {
	readonly note?: string;
	readonly title: string;
	readonly subject: string;
	readonly items: readonly AppMenuItem[];
}) {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<View>
			<Pressable
				accessibilityRole="button"
				onPress={() => setIsOpen(true)}
				accessibilityState={{ expanded: isOpen }}
				accessibilityLabel={rowActionMenuLabel(props.subject)}
				className="h-11 w-11 items-center justify-center rounded-lg"
			>
				<AppIcon className="text-text-muted" name="more-horizontal" size={18} />
			</Pressable>
			{isOpen ? (
				<BottomSheet
					title={props.title}
					description={props.subject}
					onClose={() => setIsOpen(false)}
					snapPoints={[
						SHEET_CHROME_HEIGHT +
							props.items.length * SHEET_ITEM_HEIGHT +
							(props.note === undefined ? 0 : SHEET_ITEM_HEIGHT),
					]}
				>
					<View className="gap-0.5">
						{props.items.map((item) => (
							<AppMenuItemRow key={item.label} item={item} onSelect={() => setIsOpen(false)} />
						))}
						{props.note === undefined ? null : <AppMenuNote note={props.note} />}
					</View>
				</BottomSheet>
			) : null}
		</View>
	);
}
