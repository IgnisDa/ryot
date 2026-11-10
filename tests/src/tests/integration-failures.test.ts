import { createServer } from "node:http";
import {
	BackgroundJob,
	CreateOrUpdateUserIntegrationDocument,
	DeployBackgroundJobDocument,
	IntegrationProvider,
	UserIntegrationsDocument,
} from "@ryot/generated/graphql/backend/graphql";
import { getGraphqlClient, registerTestUser, waitFor } from "src/utils";
import { describe, expect, it } from "vitest";

describe.skipIf(!process.env.MOVIES_AND_SHOWS_TMDB_ACCESS_TOKEN)(
	"Integration failure recovery",
	() => {
		it("reports partial yank failures and disables only after five fully failed syncs", async () => {
			let includeValidItem = true;
			const server = createServer((request, response) => {
				const identifiers = includeValidItem
					? ["110492", "999999999"]
					: ["999999999"];
				const container =
					request.url === "/library/sections"
						? { Directory: [{ key: "1", type: "show", title: "Shows" }] }
						: {
								Metadata: identifiers.map((id) => ({
									key: id,
									title: id,
									type: "show",
									Guid: [{ id: `tmdb://${id}` }],
								})),
							};
				response.setHeader("Content-Type", "application/json");
				response.end(JSON.stringify({ MediaContainer: container }));
			});
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);
			try {
				const address = server.address();
				if (!address || typeof address === "string") {
					throw new Error("Mock Plex server did not bind a port");
				}
				const url = process.env.API_BASE_URL as string;
				const client = getGraphqlClient(url);
				const [apiKey] = await registerTestUser(url);
				const headers = { Authorization: `Bearer ${apiKey}` };
				await client.request(
					CreateOrUpdateUserIntegrationDocument,
					{
						input: {
							syncToOwnedCollection: true,
							provider: IntegrationProvider.PlexYank,
							name: "Plex partial failure regression",
							extraSettings: { disableOnContinuousErrors: true },
							providerSpecifics: {
								plexYankToken: "test-token",
								plexYankBaseUrl: `http://127.0.0.1:${address.port}`,
							},
						},
					},
					headers,
				);
				const readIntegration = async () => {
					const result = await client.request(
						UserIntegrationsDocument,
						{},
						headers,
					);
					return result.userIntegrations[0];
				};
				const sync = async () => {
					const before = await readIntegration();
					await client.request(
						DeployBackgroundJobDocument,
						{
							jobName: BackgroundJob.SyncIntegrationsData,
						},
						headers,
					);
					for (let attempt = 0; attempt < 80; attempt++) {
						const current = await readIntegration();
						const result = current.triggerResult?.[0];
						if (
							result &&
							result.finishedAt !== before.triggerResult?.[0]?.finishedAt
						) {
							expect(result.error).toContain("404");
							expect(result.error).toMatch(
								/^Progress import failed for 1 item\(s\):/,
							);
							expect(result.error?.length).toBeLessThan(2048);
							return current;
						}
						await waitFor(250);
					}
					throw new Error("Plex sync did not finish");
				};
				for (let attempt = 0; attempt < 5; attempt++) {
					const current = await sync();
					expect(current.isDisabled).not.toBe(true);
					expect(Date.parse(current.lastFinishedAt as string)).toBe(
						Date.parse(current.triggerResult?.[0]?.finishedAt as string),
					);
				}
				const lastPartialSuccess = (await readIntegration()).lastFinishedAt;
				includeValidItem = false;
				for (let attempt = 0; attempt < 5; attempt++) {
					const current = await sync();
					expect(current.lastFinishedAt).toBe(lastPartialSuccess);
					expect(current.isDisabled ?? false).toBe(attempt === 4);
				}
			} finally {
				await new Promise<void>((resolve, reject) =>
					server.close((error) => (error ? reject(error) : resolve())),
				);
			}
		}, 120000);
	},
);
