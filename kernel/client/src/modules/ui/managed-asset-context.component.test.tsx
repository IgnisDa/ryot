import { describe, expect, it } from "@jest/globals";
import type { AssetLocator } from "@ryot/contract/modules/uploads/schemas";
import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

import { ManagedAssetUrls, useManagedAssetUrl } from "./managed-asset-context";
import { managedAssetKey } from "./managed-assets";

const profile: AssetLocator = { type: "s3", key: "profile.jpg" };
const poster: AssetLocator = { type: "local", key: "poster.jpg" };

function ResolvedUrl(props: { readonly asset: AssetLocator; readonly label: string }) {
	const url = useManagedAssetUrl(props.asset);
	return <Text>{`${props.label}: ${url}`}</Text>;
}

describe("managed asset URL context", () => {
	it("adds nested URLs without hiding parent resolutions", async () => {
		await render(
			<ManagedAssetUrls urls={new Map([[managedAssetKey(poster), "/poster"]])}>
				<ResolvedUrl label="summary" asset={poster} />
				<ManagedAssetUrls urls={new Map([[managedAssetKey(profile), "/profile"]])}>
					<ResolvedUrl label="inherited" asset={poster} />
					<ResolvedUrl label="overview" asset={profile} />
				</ManagedAssetUrls>
			</ManagedAssetUrls>,
		);

		expect(screen.getByText("summary: /poster")).toBeOnTheScreen();
		expect(screen.getByText("inherited: /poster")).toBeOnTheScreen();
		expect(screen.getByText("overview: /profile")).toBeOnTheScreen();
	});
});
