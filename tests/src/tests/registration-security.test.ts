import {
	RegisterErrorVariant,
	RegisterUserDocument,
	UserDetailsDocument,
	UserLot,
} from "@ryot/generated/graphql/backend/graphql";
import { TEST_ADMIN_ACCESS_TOKEN } from "src/utils";
import { describe, expect, it } from "vitest";
import {
	newCredentials,
	registerPasswordUser,
} from "../setup/authentication-fixtures";
import { withRegistrationServer } from "../setup/registration-server";

describe("Registration security regressions", () => {
	it("assigns one admin when the first registrations race on an empty database", async () => {
		await withRegistrationServer(
			{ allowRegistration: true },
			async ({ client }) => {
				const users = await Promise.all(
					Array.from({ length: 4 }, () => registerPasswordUser(client)),
				);
				const details = await Promise.all(
					users.map(({ apiKey }) =>
						client.request(
							UserDetailsDocument,
							{},
							{ Authorization: `Bearer ${apiKey}` },
						),
					),
				);
				const lots = details.map(({ userDetails }) => {
					if (userDetails.__typename !== "UserDetails") {
						throw new Error("Expected registered user details");
					}
					return userDetails.lot;
				});

				expect(lots.filter((lot) => lot === UserLot.Admin)).toHaveLength(1);
				expect(lots.filter((lot) => lot === UserLot.Normal)).toHaveLength(3);
			},
		);
	});

	it("limits closed registration to admin authorization", async () => {
		await withRegistrationServer(
			{ allowRegistration: false },
			async ({ client }) => {
				const blocked = await client.request(RegisterUserDocument, {
					input: { data: { password: newCredentials() } },
				});
				expect(blocked.registerUser).toEqual({
					__typename: "RegisterError",
					error: RegisterErrorVariant.Disabled,
				});

				for (const adminAccessToken of [undefined, "", "invalid-admin-token"]) {
					await expect(
						client.request(RegisterUserDocument, {
							input: {
								adminAccessToken,
								data: { password: newCredentials() },
								lot: UserLot.Admin,
							},
						}),
					).rejects.toThrow("Administrator authorization required");
				}

				const admin = await registerPasswordUser(client, {
					adminAccessToken: TEST_ADMIN_ACCESS_TOKEN,
					lot: UserLot.Admin,
				});
				const normal = await registerPasswordUser(client, {
					adminAccessToken: TEST_ADMIN_ACCESS_TOKEN,
					lot: UserLot.Normal,
				});
				const { userDetails: registeredAdminDetails } = await client.request(
					UserDetailsDocument,
					{},
					{ Authorization: `Bearer ${admin.apiKey}` },
				);
				expect(registeredAdminDetails).toMatchObject({
					__typename: "UserDetails",
					lot: UserLot.Admin,
				});
				const adminHeaders = { Authorization: `Bearer ${admin.apiKey}` };
				const normalHeaders = { Authorization: `Bearer ${normal.apiKey}` };

				const adminCreatedNormal = await registerPasswordUser(client, {
					headers: adminHeaders,
					lot: UserLot.Normal,
				});
				const { userDetails: registeredNormalDetails } = await client.request(
					UserDetailsDocument,
					{},
					{ Authorization: `Bearer ${adminCreatedNormal.apiKey}` },
				);
				expect(registeredNormalDetails).toMatchObject({
					__typename: "UserDetails",
					lot: UserLot.Normal,
				});
				await expect(
					client.request(
						RegisterUserDocument,
						{
							input: {
								data: { password: newCredentials() },
								lot: UserLot.Admin,
							},
						},
						normalHeaders,
					),
				).rejects.toThrow("Administrator authorization required");
			},
		);
	});
});
