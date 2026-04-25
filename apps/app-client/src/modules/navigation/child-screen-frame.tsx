import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { HeaderAction, HeaderLeadingControl } from "./header/header-control";
import { HeaderFrame } from "./header/header-frame";
import { HeaderOverflowMenu, type HeaderOverflowItem } from "./header/header-overflow-menu";
import { useGoBack } from "./use-go-back";

export function ChildScreenFrame(props: {
	title: string;
	hero?: ReactNode;
	meta?: ReactNode;
	children: ReactNode;
	heroHeight?: number;
	overflowItems?: readonly HeaderOverflowItem[];
}) {
	const goBack = useGoBack();
	const [isOverflowOpen, setIsOverflowOpen] = useState(false);

	return (
		<View className="relative flex-1 bg-bg">
			<HeaderFrame
				hero={props.hero}
				meta={props.meta}
				title={props.title}
				heroHeight={props.heroHeight}
				leading={<HeaderLeadingControl icon="chevron-left" label="Go back" onPress={goBack} />}
				actions={
					props.overflowItems ? (
						<HeaderAction
							label="More actions"
							icon="more-horizontal"
							onPress={() => setIsOverflowOpen(true)}
						/>
					) : undefined
				}
			>
				{props.children}
			</HeaderFrame>
			{isOverflowOpen && props.overflowItems ? (
				<HeaderOverflowMenu items={props.overflowItems} onClose={() => setIsOverflowOpen(false)} />
			) : null}
		</View>
	);
}
