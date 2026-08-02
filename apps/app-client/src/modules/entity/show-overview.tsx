import { View } from "react-native";

import { ShowDetailRow, ShowSection } from "./show-primitives";
import {
	showEpisodeCountLabel,
	showRatingLabel,
	showReleaseLabel,
	showSeasonCountLabel,
	type ShowSummary,
} from "./show-summary-state";

const detailRows = (show: ShowSummary) =>
	[
		{ label: "Entity ID", value: show.id },
		{ label: "Provider", value: show.providerName },
		{ label: "Released", value: showReleaseLabel(show) },
		{ label: "Genres", value: show.genres?.join(", ") },
		{ label: "Provider rating", value: showRatingLabel(show) },
		{ label: "Production status", value: show.productionStatus },
		{ label: "Seasons", value: showSeasonCountLabel(show) },
		{ label: "Episodes", value: showEpisodeCountLabel(show) },
	].flatMap(({ label, value }) =>
		value === null || value === undefined || value === "" ? [] : [{ label, value }],
	);

export function ShowOverview(props: { readonly show: ShowSummary }) {
	return (
		<View className="pt-4">
			<ShowSection title="About this show">
				<View>
					{detailRows(props.show).map((row) => (
						<ShowDetailRow key={row.label} label={row.label} value={row.value} />
					))}
				</View>
			</ShowSection>
		</View>
	);
}
