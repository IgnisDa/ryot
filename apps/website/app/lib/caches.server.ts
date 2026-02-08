import { randomBytes } from "node:crypto";
import { TTLCache } from "@isaacs/ttlcache";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";

dayjs.extend(duration);

const commonTtl = dayjs.duration(5, "minutes").asMilliseconds();

const otpCodesCache = new TTLCache<string, string>({
	max: 1000,
	ttl: commonTtl,
});

const generateOtp = (length: number) => {
	const max = 10 ** length;
	const buffer = randomBytes(Math.ceil(length / 2));
	const otp = Number.parseInt(buffer.toString("hex"), 16) % max;
	return otp.toString().padStart(length, "0");
};

export const setOtpCode = (email: string) => {
	const otpCode = generateOtp(6);
	otpCodesCache.set(email, otpCode);
	return otpCode;
};

export const getOtpCode = (email: string) => otpCodesCache.get(email);

export const revokeOtpCode = (email: string) => otpCodesCache.delete(email);

const cancellationCache = new TTLCache<string, boolean>({ ttl: commonTtl });

export const setCancellation = (customerId: string) =>
	cancellationCache.set(customerId, true);

export const getCancellation = (customerId: string) =>
	cancellationCache.get(customerId);

export const revokeCancellation = (customerId: string) =>
	cancellationCache.delete(customerId);

const purchaseInProgressCache = new TTLCache<string, boolean>({
	ttl: commonTtl,
});

export const setPurchaseInProgress = (customerId: string) =>
	purchaseInProgressCache.set(customerId, true);

export const getPurchaseInProgress = (customerId: string) =>
	purchaseInProgressCache.get(customerId);

export const revokePurchaseInProgress = (customerId: string) =>
	purchaseInProgressCache.delete(customerId);
