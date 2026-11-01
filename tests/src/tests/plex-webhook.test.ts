import {
	CreateOrUpdateUserIntegrationDocument,
	IntegrationProvider,
	SeenState,
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

const FIGHT_CLUB_TMDB_ID = "550";

describe("Plex sink webhook", () => {
	const url = process.env.API_BASE_URL as string;
	const client = getGraphqlClient(url);
	const headers = (key: string) => ({ Authorization: `Bearer ${key}` });

	const setupUser = async () => {
		const [apiKey] = await registerTestUser(url);
		await client.request(
			CreateOrUpdateUserIntegrationDocument,
			{
				input: {
					name: "Plex sink",
					minimumProgress: "0",
					maximumProgress: "100",
					provider: IntegrationProvider.PlexSink,
					extraSettings: { disableOnContinuousErrors: false },
					providerSpecifics: { plexSinkUsername: "plex-test-user" },
				},
			},
			headers(apiKey),
		);
		const { userIntegrations } = await client.request(
			UserIntegrationsDocument,
			{},
			headers(apiKey),
		);
		return { apiKey, integrationId: userIntegrations[0].id };
	};

	const buildPayload = (event: string, viewOffset?: number) =>
		JSON.stringify({
			event,
			user: true,
			owner: true,
			Account: { title: "plex-test-user" },
			Metadata: {
				type: "movie",
				duration: 7_200_000,
				Guid: [{ id: `tmdb://${FIGHT_CLUB_TMDB_ID}` }],
				...(viewOffset === undefined ? {} : { viewOffset }),
			},
		});

	const postWebhook = (integrationId: string, body: FormData) =>
		fetch(`${url}/backend/webhooks/integrations/${integrationId}`, {
			body,
			method: "POST",
		});

	const waitForCompletedHistory = async (apiKey: string) => {
		for (let attempt = 0; attempt < 30; attempt++) {
			const items = await getUserMetadataList(url, apiKey);
			if (items.length > 0) {
				const { userMetadataDetails } = await client.request(
					UserMetadataDetailsDocument,
					{ metadataId: items[0] },
					headers(apiKey),
				);
				const { history, inProgress } = userMetadataDetails.response;
				if (history.length > 0) return { history, inProgress };
			}
			await waitFor(1000);
		}
		throw new Error("Webhook did not produce a completed seen record");
	};

	it("accepts multipart webhooks that carry a binary thumbnail", async () => {
		const { integrationId } = await setupUser();
		const form = new FormData();
		form.append("payload", buildPayload("media.play"));
		const jpegLikeBytes = new Uint8Array([
			0xff, 0xd8, 0xff, 0xe0, 0x7d, 0x0a, 0x7b, 0x80, 0xfe, 0xff,
		]);
		form.append(
			"thumb",
			new Blob([jpegLikeBytes], { type: "image/jpeg" }),
			"thumb.jpg",
		);

		const response = await postWebhook(integrationId, form);
		expect(response.status).toBe(202);
	});

	it("rejects multipart webhooks without a payload part", async () => {
		const { integrationId } = await setupUser();
		const form = new FormData();
		form.append("other", "value");
		const response = await postWebhook(integrationId, form);
		expect(response.status).toBe(400);
	});

	it.skipIf(!process.env.MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN)(
		"completes an item when a scrobble is the only event that succeeds",
		async () => {
			const { apiKey, integrationId } = await setupUser();
			const form = new FormData();
			form.append("payload", buildPayload("media.scrobble"));
			const response = await postWebhook(integrationId, form);
			expect(response.status).toBe(202);

			const items = await waitForCompletedHistory(apiKey);
			expect(items.inProgress ?? null).toBeNull();
			expect(items.history).toHaveLength(1);
			expect(items.history[0].state).toBe(SeenState.Completed);
			expect(items.history[0].progress).toBe("100");
		},
	);
});
