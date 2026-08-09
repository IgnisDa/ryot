import type { TPlanTypes, TProductTypes } from "~/drizzle/schema.server";

export type PricingMetadata = {
	trial?: number;
	amount?: number;
	linkToGithub?: boolean;
};

export type PaymentPrice = PricingMetadata & {
	name: TPlanTypes;
	priceId?: string;
	productId?: string;
};

export type PaymentProduct = {
	type: TProductTypes;
	prices: PaymentPrice[];
};

export type PaymentProvider = "paddle" | "polar";
export type PaymentCatalogStatus = "active" | "legacy";
export type PaymentEnvironment = "sandbox" | "production";

type PaymentCatalog = Record<
	PaymentProvider,
	Record<PaymentEnvironment, Record<PaymentCatalogStatus, PaymentProduct[]>>
>;

const paddlePrice = (
	name: TPlanTypes,
	priceId: string,
	metadata: PricingMetadata = {},
) => ({ name, priceId, ...metadata });

const polarPrice = (
	name: TPlanTypes,
	productId: string,
	priceId: string,
	metadata: PricingMetadata = {},
) => ({ name, productId, priceId, ...metadata });

export const PAYMENT_CATALOG: PaymentCatalog = {
	paddle: {
		sandbox: {
			active: [
				{
					type: "cloud",
					prices: [
						paddlePrice("monthly", "pri_01kzgt4b5zv0tg75f2e5ss8nrk", {
							amount: 6,
							trial: 7,
						}),
						paddlePrice("yearly", "pri_01kzgt5r9rwatck1yrk58v79fg", {
							amount: 50,
							trial: 14,
						}),
					],
				},
				{
					type: "self_hosted",
					prices: [
						{ name: "free", linkToGithub: true },
						paddlePrice("monthly", "pri_01kzgte98z6tjatyjxkfkdb9c9", {
							amount: 4,
						}),
						paddlePrice("yearly", "pri_01kzgtctzch547svd5cnk0p8b6", {
							amount: 35,
						}),
						paddlePrice("lifetime", "pri_01kzgt9sztgq4jrd6sc408mbse", {
							amount: 120,
						}),
					],
				},
			],
			legacy: [
				{
					type: "cloud",
					prices: [
						paddlePrice("monthly", "pri_01j3jpqer93vdzwzdw6a3frefy", {
							amount: 3,
							trial: 7,
						}),
						paddlePrice("yearly", "pri_01j3jppmjzaeb4wxraeptzqk3q", {
							amount: 30,
							trial: 14,
						}),
						paddlePrice("lifetime", "pri_01j3jpnpbkfdsbn5e7f38vs66b", {
							amount: 90,
						}),
					],
				},
				{
					type: "self_hosted",
					prices: [
						paddlePrice("monthly", "pri_01j237s5y1hz6061fayt8z504d", {
							amount: 2,
						}),
						paddlePrice("yearly", "pri_01j237tn2knfdpxc9c6tmhf08f", {
							amount: 20,
						}),
						paddlePrice("lifetime", "pri_01j237vrsqzxr5g0ctwr226tr6", {
							amount: 60,
						}),
					],
				},
			],
		},
		production: {
			active: [
				{
					type: "cloud",
					prices: [
						paddlePrice("monthly", "pri_01kzgtkkpsqy9dz1pv3yw18rgm", {
							amount: 6,
							trial: 7,
						}),
						paddlePrice("yearly", "pri_01kzgtmrjyb0twwd3hwv92p97y", {
							amount: 50,
							trial: 14,
						}),
					],
				},
				{
					type: "self_hosted",
					prices: [
						{ name: "free", linkToGithub: true },
						paddlePrice("monthly", "pri_01kzgtr1ct5nxzhmdery5xhgc7", {
							amount: 4,
						}),
						paddlePrice("yearly", "pri_01kzgtq7g4qexnaz041w0fdsqz", {
							amount: 35,
						}),
						paddlePrice("lifetime", "pri_01kzgtp9hxx594bfdfnzg1ds3j", {
							amount: 120,
						}),
					],
				},
			],
			legacy: [
				{
					type: "cloud",
					prices: [
						paddlePrice("monthly", "pri_01j3jhddt6kejw8b03qb0480n6", {
							amount: 3,
							trial: 7,
						}),
						paddlePrice("yearly", "pri_01j3jhee8h0z6b1r1y7k7xqac8", {
							amount: 30,
							trial: 14,
						}),
						paddlePrice("lifetime", "pri_01j3jhfa4g6ctw3610hj7accjc", {
							amount: 90,
						}),
					],
				},
				{
					type: "self_hosted",
					prices: [
						paddlePrice("monthly", "pri_01j0sxqx6b25vywf1xvm808gv3", {
							amount: 2,
						}),
						paddlePrice("yearly", "pri_01j0sxsgqcapxkfdbh3g8a6973", {
							amount: 20,
						}),
						paddlePrice("lifetime", "pri_01j0sxtqjt50ckf17jcxex8wft", {
							amount: 60,
						}),
					],
				},
			],
		},
	},
	polar: {
		sandbox: {
			active: [
				{
					type: "cloud",
					prices: [
						polarPrice(
							"monthly",
							"6d7234b3-668d-44ba-97ac-c6a5e7e2e42c",
							"bea67a18-4d2d-41de-8007-477625340933",
							{ amount: 6, trial: 7 },
						),
						polarPrice(
							"yearly",
							"6e9786a9-0a15-4aeb-b226-d97daf485e8c",
							"dfef5e6d-4730-48a0-a0b1-fc78e5530e98",
							{ amount: 50, trial: 14 },
						),
					],
				},
				{
					type: "self_hosted",
					prices: [
						{ name: "free", linkToGithub: true },
						polarPrice(
							"monthly",
							"d159c4bb-7de0-46f4-9d80-23f0b81cc599",
							"519d6a36-f140-4e42-b1a2-b22a4613faba",
							{ amount: 4 },
						),
						polarPrice(
							"yearly",
							"d24ac9e9-1eb3-4195-b5cd-fc67efd0e399",
							"75cc7231-07f6-444c-ba54-682bac22b6c7",
							{ amount: 35 },
						),
						polarPrice(
							"lifetime",
							"40e76118-4537-40c1-bb07-709d62122794",
							"6f55694e-15c5-4368-ae91-7a303c8f8fd3",
							{ amount: 120 },
						),
					],
				},
			],
			legacy: [
				{
					type: "cloud",
					prices: [
						polarPrice(
							"monthly",
							"f1075182-46d5-4936-96ab-7181d788ac4a",
							"80045896-68b9-4af5-b358-9f06ee822152",
							{ amount: 3, trial: 7 },
						),
						polarPrice(
							"yearly",
							"b0025c53-ffdb-4fec-a47a-c0266c0c13d6",
							"077c2e33-98ab-40e5-9842-9fa8410ea42b",
							{ amount: 30, trial: 14 },
						),
						polarPrice(
							"lifetime",
							"ee44402b-d348-4bab-9a4f-ed567c61a4ad",
							"e929cdfe-e345-405c-ad96-451b6c160f60",
							{ amount: 90 },
						),
					],
				},
				{
					type: "self_hosted",
					prices: [
						polarPrice(
							"monthly",
							"c7c6b665-186b-4945-8040-da6a1547635e",
							"91eceefb-ddec-4a63-a5af-949ac65dd14d",
							{ amount: 2 },
						),
						polarPrice(
							"yearly",
							"c683473b-a0b5-4c49-93f8-fd4b9ced953c",
							"bd2b7c30-aacb-4eb1-b05f-1551731eda28",
							{ amount: 20 },
						),
						polarPrice(
							"lifetime",
							"fe0b8060-4cb7-48c9-a1ff-f3cc261930f9",
							"e6ac7056-8012-46c7-b60f-830012964a16",
							{ amount: 60 },
						),
					],
				},
			],
		},
		production: {
			active: [
				{
					type: "cloud",
					prices: [
						polarPrice(
							"monthly",
							"a658a978-826e-4ee5-92ef-7eab11db78dc",
							"49a60c5a-ca28-4147-bc82-dcef9bfba4b3",
							{ amount: 6, trial: 7 },
						),
						polarPrice(
							"yearly",
							"48905e2a-85e6-45c1-9000-e19102de77b9",
							"48ce231d-df76-4181-a841-2dd5a345058a",
							{ amount: 50, trial: 14 },
						),
					],
				},
				{
					type: "self_hosted",
					prices: [
						{ name: "free", linkToGithub: true },
						polarPrice(
							"monthly",
							"e5e4926a-92e4-4441-8db3-49484b2181a3",
							"cb95b611-460c-438a-bf78-13703b95e68c",
							{ amount: 4 },
						),
						polarPrice(
							"yearly",
							"a7561d3d-3b10-48ac-a54f-78495e773a0f",
							"6dc7a297-98c5-4756-9b21-ff0b5f1ca7d7",
							{ amount: 35 },
						),
						polarPrice(
							"lifetime",
							"22ad1748-dcbf-4a55-8131-436af0f66918",
							"1a08547f-dec5-4d5c-a7b6-7f754fa27bb2",
							{ amount: 120 },
						),
					],
				},
			],
			legacy: [
				{
					type: "cloud",
					prices: [
						polarPrice(
							"monthly",
							"b563e6e4-cca7-4136-b06c-f0eac3d41f8f",
							"f9a6b1b9-4e6c-495a-86e1-572d94d65c89",
							{ amount: 3, trial: 7 },
						),
						polarPrice(
							"yearly",
							"b4441f58-db99-45bf-ae72-8d0d73d92dea",
							"5f57aa5b-7c59-4fff-9444-b667f12b7796",
							{ amount: 30, trial: 14 },
						),
						polarPrice(
							"lifetime",
							"357395ee-2ba0-46a5-bcb2-59a583587030",
							"18c16249-be88-4aa7-9014-f192161bc4de",
							{ amount: 90 },
						),
					],
				},
				{
					type: "self_hosted",
					prices: [
						polarPrice(
							"monthly",
							"b72d6d4b-7fb5-4fa1-b3ee-d9088485a9bf",
							"72be43fd-e30a-4754-9d5a-b227f0e587ad",
							{ amount: 2 },
						),
						polarPrice(
							"yearly",
							"d9c7e138-0423-4bfb-984a-e84608a707fa",
							"5b0f56f2-69db-4864-a5e3-8f0b2c146a92",
							{ amount: 20 },
						),
						polarPrice(
							"lifetime",
							"67c346a3-b341-40d5-a8e9-28eda61db1fe",
							"6911a58a-7848-4913-8546-9afffe8cb1ff",
							{ amount: 60 },
						),
					],
				},
			],
		},
	},
};

export const getPaymentEnvironment = (
	isSandbox: boolean | undefined,
): PaymentEnvironment => (isSandbox ? "sandbox" : "production");

export const getPaymentCatalog = (
	provider: PaymentProvider,
	environment: PaymentEnvironment,
	status: PaymentCatalogStatus = "active",
) => PAYMENT_CATALOG[provider][environment][status];

export const getActivePaymentCatalog = (
	provider: PaymentProvider,
	environment: PaymentEnvironment,
) => getPaymentCatalog(provider, environment, "active");

export const getLegacyPaymentCatalog = (
	provider: PaymentProvider,
	environment: PaymentEnvironment,
) => getPaymentCatalog(provider, environment, "legacy");
