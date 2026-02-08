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

export const getOtpCode = (email: string) => {
	return otpCodesCache.get(email);
};
