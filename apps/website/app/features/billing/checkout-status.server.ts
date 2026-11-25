import { TTLCache } from "@isaacs/ttlcache";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";

dayjs.extend(duration);

const commonTtl = dayjs.duration(5, "minutes").asMilliseconds();

const cancellationCache = new TTLCache<string, boolean>({ ttl: commonTtl });

export const setCancellation = (customerId: string) => cancellationCache.set(customerId, true);

export const getCancellation = (customerId: string) => cancellationCache.get(customerId);

export const revokeCancellation = (customerId: string) => cancellationCache.delete(customerId);

const purchaseInProgressCache = new TTLCache<string, boolean>({ ttl: commonTtl });

export const setPurchaseInProgress = (customerId: string) =>
	purchaseInProgressCache.set(customerId, true);

export const getPurchaseInProgress = (customerId: string) =>
	purchaseInProgressCache.get(customerId);

export const revokePurchaseInProgress = (customerId: string) =>
	purchaseInProgressCache.delete(customerId);
