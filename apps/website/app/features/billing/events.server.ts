import PurchaseCompleteEmail from "@ryot-app/email-templates/emails/purchase-complete";
import { memoize } from "@ryot-app/ts-utils/lodash";
import type { Dayjs } from "dayjs";
import { and, desc, eq, isNull } from "drizzle-orm";
import { DateTime, Effect } from "effect";
import type { SecureRandom } from "effect/crypto";
import type { HttpClient } from "effect/http";
import postgres from "postgres";

import {
	billingEvent,
	customer,
	customerPurchase,
	type TPaymentProviders,
} from "~/drizzle/schema.server";
import {
	revokeCancellation,
	revokePurchaseInProgress,
} from "~/features/billing/checkout-status.server";
import { getDb, getServerVariables, paymentEnvironment } from "~/server/config.server";
import { fromPromise, WebsiteFailure } from "~/server/effect.server";
import { sendEmail } from "~/server/mail.server";

import { findPaymentPlan } from "./catalog";
import { openNotice, sealNotice } from "./notice.server";
import {
	cloudPurchaseNotice,
	createUnkeyKey,
	type Customer,
	provisionCloudUser,
	setPurchaseAccess,
	updateKeyAccess,
} from "./provisioning.server";
import { calculateRenewalDate, formatDateToNaiveDate } from "./renewal";

export type PaymentEvent = (
	{ kind: "resumed" | "cancelled" } | { kind: "paid"; priceId?: string; productId?: string }
) & {
	id: string;
	providerCustomerId: string;
	websiteCustomerId?: string;
	provider: TPaymentProviders;
};

const getLocks = memoize(() => postgres(getServerVariables().DATABASE_URL, { max: 4 }));

type Transaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

const transact = <A, E>(run: (tx: Transaction) => Effect.Effect<A, E>) =>
	Effect.gen(function* () {
		const context = yield* Effect.context();
		return yield* fromPromise(() =>
			getDb().transaction((tx) => Effect.runPromiseWith(context)(run(tx))),
		);
	});

const findCustomer = Effect.fn(function* (event: PaymentEvent) {
	const providerColumn =
		event.provider === "paddle" ? customer.paddleCustomerId : customer.polarCustomerId;
	const existing = yield* fromPromise(() =>
		getDb().query.customer.findFirst({ where: eq(providerColumn, event.providerCustomerId) }),
	);
	if (existing || !event.websiteCustomerId) {
		return existing;
	}
	const id = event.websiteCustomerId;
	return yield* fromPromise(() => getDb().query.customer.findFirst({ where: eq(customer.id, id) }));
});

const eventFilter = (event: PaymentEvent) =>
	and(eq(billingEvent.provider, event.provider), eq(billingEvent.id, event.id));

const recordEvent = Effect.fn(function* (event: PaymentEvent, customerId: string) {
	const db = getDb();
	const previous = yield* fromPromise(() =>
		db.query.billingEvent.findFirst({ where: eventFilter(event) }),
	);
	if (previous) {
		if (previous.customerId !== customerId) {
			return yield* new WebsiteFailure({ cause: "Billing event customer changed" });
		}
		return previous;
	}
	const pending = yield* fromPromise(() =>
		db.query.billingEvent.findFirst({
			columns: { id: true },
			where: and(eq(billingEvent.customerId, customerId), isNull(billingEvent.completedOn)),
		}),
	);
	if (pending) {
		return yield* new WebsiteFailure({ cause: "A previous billing event is awaiting retry" });
	}
	const inserted = yield* transact((tx) =>
		Effect.gen(function* () {
			const result = (yield* fromPromise(() =>
				tx
					.insert(billingEvent)
					.values({ customerId, id: event.id, provider: event.provider })
					.onConflictDoNothing()
					.returning(),
			)).at(0);
			if (!result) {
				return yield* new WebsiteFailure({ cause: "Billing event identity is already in use" });
			}
			if (event.kind === "paid") {
				const providerCustomer =
					event.provider === "paddle"
						? { paddleCustomerId: event.providerCustomerId }
						: { polarCustomerId: event.providerCustomerId };
				yield* fromPromise(() =>
					tx.update(customer).set(providerCustomer).where(eq(customer.id, customerId)),
				);
			}
			return result;
		}),
	);
	return inserted;
});

const completeEvent = (tx: Transaction, event: PaymentEvent, now: Date) =>
	fromPromise(() =>
		tx.update(billingEvent).set({ notice: null, completedOn: now }).where(eventFilter(event)),
	);

const planFor = (event: Extract<PaymentEvent, { kind: "paid" }>) =>
	findPaymentPlan(event.provider, paymentEnvironment(event.provider), (_, price) =>
		event.provider === "paddle"
			? price.priceId === event.priceId
			: price.productId === event.productId && (!event.priceId || price.priceId === event.priceId),
	);

const processEvent = Effect.fn(function* (account: Customer, event: PaymentEvent) {
	const db = getDb();
	const plan = event.kind === "paid" ? planFor(event) : null;
	if (plan === undefined) {
		return yield* new WebsiteFailure({ cause: "Payment plan is absent from the catalog" });
	}
	const record = yield* recordEvent(event, account.id);
	const now = yield* DateTime.nowAsDate;
	if (record.completedOn) {
		return undefined;
	}

	const active = yield* fromPromise(() =>
		db.query.customerPurchase.findFirst({
			orderBy: [desc(customerPurchase.createdOn)],
			where: and(eq(customerPurchase.customerId, account.id), isNull(customerPurchase.cancelledOn)),
		}),
	);

	if (event.kind !== "paid") {
		const purchase =
			event.kind === "cancelled"
				? active
				: yield* fromPromise(() =>
						db.query.customerPurchase.findFirst({
							orderBy: [desc(customerPurchase.createdOn)],
							where: eq(customerPurchase.customerId, account.id),
						}),
					);
		if (purchase) {
			yield* setPurchaseAccess(account, event.kind === "resumed");
		}
		yield* transact((tx) =>
			Effect.gen(function* () {
				if (purchase) {
					yield* fromPromise(() =>
						tx
							.update(customerPurchase)
							.set({ updatedOn: now, cancelledOn: event.kind === "cancelled" ? now : null })
							.where(eq(customerPurchase.id, purchase.id)),
					);
				}
				yield* completeEvent(tx, event, now);
			}),
		);
		revokeCancellation(account.id);
		return undefined;
	}

	if (!plan) {
		return yield* new WebsiteFailure({ cause: "Purchase event has no plan" });
	}
	const { planType, productType } = plan;
	const renewOn = calculateRenewalDate(planType, record.createdOn);

	if (active) {
		yield* setPurchaseAccess(account, true, renewOn);
	} else if (!record.notifiedOn) {
		const notice = record.notice
			? yield* openNotice(record.notice)
			: yield* prepareNotice(account, event, productType, renewOn);
		const element = PurchaseCompleteEmail({
			planType,
			details: notice,
			renewOn: renewOn ? formatDateToNaiveDate(renewOn) : undefined,
		});
		if (!element) {
			return yield* new WebsiteFailure({ cause: "Purchase confirmation email is missing" });
		}
		yield* sendEmail({ element, recipient: account.email, subject: PurchaseCompleteEmail.subject });
		const notifiedOn = yield* DateTime.nowAsDate;
		yield* fromPromise(() =>
			db.update(billingEvent).set({ notifiedOn, notice: null }).where(eventFilter(event)),
		);
	}

	const purchase = {
		planType,
		productType,
		paymentProvider: event.provider,
		renewOn: renewOn?.toDate() ?? null,
		providerPriceId: event.priceId ?? null,
		providerProductId: event.productId ?? null,
	};
	yield* transact((tx) =>
		Effect.gen(function* () {
			if (active) {
				yield* fromPromise(() =>
					tx
						.update(customerPurchase)
						.set({ ...purchase, updatedOn: now })
						.where(eq(customerPurchase.id, active.id)),
				);
			} else {
				yield* fromPromise(() =>
					tx.insert(customerPurchase).values({ ...purchase, customerId: account.id }),
				);
			}
			yield* completeEvent(tx, event, now);
		}),
	);
	revokePurchaseInProgress(account.id);
	return undefined;
});

const prepareNotice = Effect.fn(function* (
	account: Customer,
	event: PaymentEvent,
	productType: typeof customerPurchase.$inferSelect.productType,
	renewOn: null | Dayjs,
) {
	const db = getDb();
	if (productType === "cloud") {
		const userId = yield* provisionCloudUser(account);
		if (userId !== account.ryotUserId) {
			yield* fromPromise(() =>
				db.update(customer).set({ ryotUserId: userId }).where(eq(customer.id, account.id)),
			);
		}
		const details = yield* cloudPurchaseNotice(account, userId);
		const notice = yield* sealNotice(details);
		yield* fromPromise(() => db.update(billingEvent).set({ notice }).where(eventFilter(event)));
		return details;
	}

	const existingKey = account.unkeyKeyId;
	const key = existingKey
		? yield* updateKeyAccess(existingKey, true, renewOn).pipe(
				Effect.as({ keyId: existingKey, key: "API key reactivated with new expiry" }),
			)
		: yield* createUnkeyKey(account, renewOn);

	const details = { key: key.key, kind: "self_hosted" } as const;
	const notice = yield* sealNotice(details);
	yield* transact((tx) =>
		Effect.gen(function* () {
			yield* fromPromise(() =>
				tx.update(customer).set({ unkeyKeyId: key.keyId }).where(eq(customer.id, account.id)),
			);
			yield* fromPromise(() => tx.update(billingEvent).set({ notice }).where(eventFilter(event)));
		}),
	);
	return details;
});

export const processPaymentEvent = Effect.fn(function* (event: PaymentEvent) {
	const account = yield* findCustomer(event);
	if (!account) {
		return undefined;
	}

	const context = yield* Effect.context<HttpClient.HttpClient | SecureRandom.SecureRandom>();
	const result = yield* fromPromise(() =>
		getLocks().begin((sql) =>
			Effect.runPromiseExitWith(context)(
				Effect.gen(function* () {
					// Checkpoint writes commit on a separate connection while the customer lock is held.
					const [lock] = yield* fromPromise(
						() =>
							sql<
								{ acquired: boolean }[]
							>`select pg_try_advisory_xact_lock(hashtextextended(${account.id}, 0)) as acquired`,
					);
					if (!lock.acquired) {
						return yield* new WebsiteFailure({
							cause: "Another billing event is processing this customer",
						});
					}
					const freshCustomer = yield* fromPromise(() =>
						getDb().query.customer.findFirst({ where: eq(customer.id, account.id) }),
					);
					if (!freshCustomer) {
						return yield* new WebsiteFailure({ cause: "Billing customer no longer exists" });
					}
					return yield* processEvent(freshCustomer, event);
				}),
			),
		),
	);
	return yield* result;
});
