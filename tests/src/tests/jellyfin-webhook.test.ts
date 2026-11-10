import {
	CreateOrUpdateUserIntegrationDocument,
	DeleteSeenItemDocument,
	IntegrationProvider,
	UserIntegrationsDocument,
	UserMetadataDetailsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import {
	getGraphqlClient,
	getUserMetadataList,
	registerTestUser,
	waitFor,
} from "src/utils";
import { describe, expect, it } from "vitest";

describe.skipIf(!process.env.MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN)(
	"Jellyfin episode recovery",
	() => {
		const url = process.env.API_BASE_URL as string;
		const client = getGraphqlClient(url);

		it("uses series IDs, deduplicates completion, and recovers after history deletion", async () => {
			const [apiKey] = await registerTestUser(url);
			const headers = { Authorization: `Bearer ${apiKey}` };
			await client.request(
				CreateOrUpdateUserIntegrationDocument,
				{
					input: {
						name: "Jellyfin regression",
						minimumProgress: "0",
						maximumProgress: "100",
						provider: IntegrationProvider.JellyfinSink,
						extraSettings: { disableOnContinuousErrors: false },
						providerSpecifics: { jellyfinSinkUsername: "alice" },
					},
				},
				headers,
			);
			const { userIntegrations } = await client.request(
				UserIntegrationsDocument,
				{},
				headers,
			);
			const integrationId = userIntegrations[0].id;
			const send = async (event: string, seriesId = "110492") => {
				const before = await client.request(
					UserIntegrationsDocument,
					{},
					headers,
				);
				const previous =
					before.userIntegrations[0].triggerResult?.[0]?.finishedAt;
				const response = await fetch(
					`${url}/backend/webhooks/integrations/${integrationId}`,
					{
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							Event: event,
							User: { Name: "alice" },
							Series: { ProviderIds: { Tmdb: seriesId } },
							Session: { PlayState: { PositionTicks: 250 } },
							Item: {
								Type: "Episode",
								IndexNumber: 2,
								RunTimeTicks: 1000,
								ParentIndexNumber: 1,
								ProviderIds: { Tmdb: "2438351" },
								Name: "Best Friends, For Never",
							},
						}),
					},
				);
				expect(response.status).toBe(202);
				for (let attempt = 0; attempt < 40; attempt++) {
					const current = await client.request(
						UserIntegrationsDocument,
						{},
						headers,
					);
					const result = current.userIntegrations[0].triggerResult?.[0];
					if (result?.finishedAt && result.finishedAt !== previous) {
						if (seriesId === "999999999") {
							expect(result.error).toContain("404");
						} else {
							expect(result.error ?? null).toBeNull();
						}
						return;
					}
					await waitFor(250);
				}
				throw new Error("Jellyfin trigger did not finish");
			};
			await send("MarkPlayed", "999999999");
			await send("MarkPlayed");
			const items = await getUserMetadataList(url, apiKey);
			expect(items).toHaveLength(1);
			const history = async () => {
				const result = await client.request(
					UserMetadataDetailsDocument,
					{ metadataId: items[0] },
					headers,
				);
				return result.userMetadataDetails.response.history;
			};
			await send("MarkPlayed");
			const completed = await history();
			expect(completed).toHaveLength(1);
			expect(completed[0].progress).toBe("100");
			await client.request(
				DeleteSeenItemDocument,
				{ seenId: completed[0].id },
				headers,
			);
			await send("Progress");
			const resumed = await history();
			expect(resumed).toHaveLength(1);
			expect(Number(resumed[0].progress)).toBe(25);
			await client.request(
				DeleteSeenItemDocument,
				{ seenId: resumed[0].id },
				headers,
			);
			await send("Progress");
			const recreated = await history();
			expect(recreated).toHaveLength(1);
			expect(recreated[0].id).not.toBe(resumed[0].id);
		}, 60000);
	},
);
