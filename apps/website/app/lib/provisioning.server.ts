import {
	GetPasswordChangeSessionDocument,
	RegisterUserDocument,
	UpdateUserDocument,
} from "@ryot/generated/graphql/backend/graphql";
import PurchaseCompleteEmail, {
	type PurchaseCompleteEmailProps,
} from "@ryot/transactional/emails/purchase-complete";
import { formatDateToNaiveDate } from "@ryot/ts-utils";
import { Unkey } from "@unkey/api";
import { and, eq, type InferSelectModel, isNull } from "drizzle-orm";
import {
	customerPurchases,
	customers,
	type TPlanTypes,
	type TProductTypes,
} from "~/drizzle/schema.server";
import {
	GRACE_PERIOD,
	getDb,
	getServerGqlService,
	getServerVariables,
} from "./config.server";
import {
	calculateRenewalDate,
	createUnkeyKey,
	sendEmail,
} from "./utilities.server";

type Customer = InferSelectModel<typeof customers>;

async function handleCloudPurchase(customer: Customer): Promise<{
	ryotUserId: string;
	unkeyKeyId: null;
	details: PurchaseCompleteEmailProps["details"];
}> {
	const { email, oidcIssuerId } = customer;
	const serverVariables = getServerVariables();

	if (customer.ryotUserId) {
		await getServerGqlService().request(UpdateUserDocument, {
			input: {
				isDisabled: false,
				userId: customer.ryotUserId,
				adminAccessToken: serverVariables.SERVER_ADMIN_ACCESS_TOKEN,
			},
		});
		return {
			ryotUserId: customer.ryotUserId,
			unkeyKeyId: null,
			details: {
				__typename: "cloud",
				auth: oidcIssuerId ? email : "User reactivated",
			},
		};
	}

	const { registerUser } = await getServerGqlService().request(
		RegisterUserDocument,
		{
			input: {
				adminAccessToken: serverVariables.SERVER_ADMIN_ACCESS_TOKEN,
				data: oidcIssuerId
					? { oidc: { email: email, issuerId: oidcIssuerId } }
					: { password: { username: email, password: "" } },
			},
		},
	);
	if (registerUser.__typename === "RegisterError") {
		console.error(registerUser);
		throw new Error("Failed to register user");
	}

	const auth = oidcIssuerId
		? email
		: await getServerGqlService()
				.request(GetPasswordChangeSessionDocument, {
					input: {
						userId: registerUser.id,
						adminAccessToken: serverVariables.SERVER_ADMIN_ACCESS_TOKEN,
					},
				})
				.then(({ getPasswordChangeSession }) => ({
					username: email,
					passwordChangeUrl: getPasswordChangeSession.passwordChangeUrl,
				}));

	return {
		unkeyKeyId: null,
		ryotUserId: registerUser.id,
		details: { auth, __typename: "cloud" },
	};
}

async function handleSelfHostedPurchase(
	customer: Customer,
	planType: TPlanTypes,
): Promise<{
	ryotUserId: null;
	unkeyKeyId: string;
	details: PurchaseCompleteEmailProps["details"];
}> {
	const serverVariables = getServerVariables();
	const unkey = new Unkey({ rootKey: serverVariables.UNKEY_ROOT_KEY });
	const renewalDate = calculateRenewalDate(planType);

	if (customer.unkeyKeyId) {
		await unkey.keys.updateKey({
			enabled: true,
			keyId: customer.unkeyKeyId,
			meta: renewalDate
				? {
						expiry: formatDateToNaiveDate(
							renewalDate.add(GRACE_PERIOD, "days"),
						),
					}
				: undefined,
		});
		return {
			ryotUserId: null,
			unkeyKeyId: customer.unkeyKeyId,
			details: {
				__typename: "self_hosted",
				key: "API key reactivated with new expiry",
			},
		};
	}

	const created = await createUnkeyKey(
		customer,
		renewalDate ? renewalDate.add(GRACE_PERIOD, "days") : undefined,
	);
	return {
		ryotUserId: null,
		unkeyKeyId: created.keyId,
		details: { key: created.key, __typename: "self_hosted" },
	};
}

export async function provisionNewPurchase(
	customer: Customer,
	planType: TPlanTypes,
	productType: TProductTypes,
	paymentProviderCustomerId?: string,
) {
	const { ryotUserId, unkeyKeyId, details } =
		productType === "cloud"
			? await handleCloudPurchase(customer)
			: await handleSelfHostedPurchase(customer, planType);

	const renewalDate = calculateRenewalDate(planType);
	const renewOn = renewalDate ? formatDateToNaiveDate(renewalDate) : undefined;

	const emailElement = PurchaseCompleteEmail({ renewOn, details, planType });
	if (!emailElement) throw new Error("Failed to create email element");

	await sendEmail({
		element: emailElement,
		recipient: customer.email,
		subject: PurchaseCompleteEmail.subject,
	});

	await getDb().insert(customerPurchases).values({
		planType,
		productType,
		customerId: customer.id,
		renewOn: renewalDate?.toDate(),
	});

	const updateData: {
		ryotUserId?: string | null;
		unkeyKeyId?: string | null;
		polarCustomerId?: string | null;
		paddleCustomerId?: string | null;
	} = {};

	if (ryotUserId && ryotUserId !== customer.ryotUserId)
		updateData.ryotUserId = ryotUserId;
	if (unkeyKeyId && unkeyKeyId !== customer.unkeyKeyId)
		updateData.unkeyKeyId = unkeyKeyId;

	if (customer.paymentProvider === "paddle" && paymentProviderCustomerId) {
		if (paymentProviderCustomerId !== customer.paddleCustomerId)
			updateData.paddleCustomerId = paymentProviderCustomerId;
	} else if (
		customer.paymentProvider === "polar" &&
		paymentProviderCustomerId
	) {
		if (paymentProviderCustomerId !== customer.polarCustomerId)
			updateData.polarCustomerId = paymentProviderCustomerId;
	}

	if (Object.keys(updateData).length > 0) {
		await getDb()
			.update(customers)
			.set(updateData)
			.where(eq(customers.id, customer.id));
	}
}

export async function provisionRenewal(
	customer: Customer,
	planType: TPlanTypes,
	productType: TProductTypes,
	activePurchase: InferSelectModel<typeof customerPurchases>,
) {
	const serverVariables = getServerVariables();
	const renewalDate = calculateRenewalDate(planType);
	await getDb()
		.update(customerPurchases)
		.set({
			planType,
			productType,
			updatedOn: new Date(),
			renewOn: renewalDate?.toDate(),
		})
		.where(eq(customerPurchases.id, activePurchase.id));

	if (customer.ryotUserId)
		await getServerGqlService().request(UpdateUserDocument, {
			input: {
				isDisabled: false,
				userId: customer.ryotUserId,
				adminAccessToken: serverVariables.SERVER_ADMIN_ACCESS_TOKEN,
			},
		});

	if (customer.unkeyKeyId) {
		const unkey = new Unkey({ rootKey: serverVariables.UNKEY_ROOT_KEY });

		await unkey.keys.updateKey({
			enabled: true,
			keyId: customer.unkeyKeyId,
			meta: renewalDate
				? {
						expiry: formatDateToNaiveDate(
							renewalDate.add(GRACE_PERIOD, "days"),
						),
					}
				: undefined,
		});
	}
}

export async function revokePurchase(customer: Customer) {
	await getDb()
		.update(customerPurchases)
		.set({
			cancelledOn: new Date(),
			updatedOn: new Date(),
		})
		.where(
			and(
				eq(customerPurchases.customerId, customer.id),
				isNull(customerPurchases.cancelledOn),
			),
		);

	if (customer.ryotUserId) {
		const serverVariables = getServerVariables();
		await getServerGqlService().request(UpdateUserDocument, {
			input: {
				isDisabled: true,
				userId: customer.ryotUserId,
				adminAccessToken: serverVariables.SERVER_ADMIN_ACCESS_TOKEN,
			},
		});
	}

	if (customer.unkeyKeyId) {
		const serverVariables = getServerVariables();
		const unkey = new Unkey({ rootKey: serverVariables.UNKEY_ROOT_KEY });
		await unkey.keys.updateKey({
			enabled: false,
			keyId: customer.unkeyKeyId,
		});
	}
}

export async function getActivePurchase(customerId: string) {
	return await getDb().query.customerPurchases.findFirst({
		where: and(
			eq(customerPurchases.customerId, customerId),
			isNull(customerPurchases.cancelledOn),
		),
	});
}
