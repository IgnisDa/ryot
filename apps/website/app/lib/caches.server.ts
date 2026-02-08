import { randomBytes } from "node:crypto";
import { TTLCache } from "@isaacs/ttlcache";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";

dayjs.extend(duration);

const otpCodesCache = new TTLCache<string, string>({
	max: 1000,
	ttl: dayjs.duration(5, "minutes").asMilliseconds(),
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

const cancellationCache = new TTLCache<string, boolean>({
	max: 1000,
	ttl: dayjs.duration(5, "minutes").asMilliseconds(),
});

export const setCancellation = (customerId: string) =>
	cancellationCache.set(customerId, true);

export const getCancellation = (customerId: string) =>
	cancellationCache.get(customerId);

export const revokeCancellation = (customerId: string) =>
	cancellationCache.delete(customerId);

const purchaseInProgressCache = new TTLCache<string, boolean>({
	max: 1000,
	ttl: dayjs.duration(5, "minutes").asMilliseconds(),
});

export const setPurchaseInProgress = (customerId: string) =>
	purchaseInProgressCache.set(customerId, true);

export const getPurchaseInProgress = (customerId: string) =>
	purchaseInProgressCache.get(customerId);

export const revokePurchaseInProgress = (customerId: string) =>
	purchaseInProgressCache.delete(customerId);
