import clsx from "clsx";
import { Text, View } from "react-native";

export function AppTableHeader(props: {
	readonly columns: ReadonlyArray<{ readonly label: string; readonly className: string }>;
}) {
	return (
		<View className="h-8.5 flex-row items-center gap-3 border-b border-border md:gap-4">
			{props.columns.map((column) => (
				<View key={column.label} className={clsx(column.className, "justify-center")}>
					<Text
						numberOfLines={1}
						className="font-ui-semibold text-[11.5px] uppercase tracking-[0.6px] text-text-subtle"
					>
						{column.label}
					</Text>
				</View>
			))}
		</View>
	);
}
