import type { SystemConfigResponse } from "@ryot-app/contract/modules/system/contract";
import { AsyncResult } from "effect/unstable/reactivity";

/**
 * Fails safe to the community version while loading or on failure, matching the backend's own
 * fallback posture when the Pro key cannot be verified.
 */
export const isServerKeyValidated = (
	config: AsyncResult.AsyncResult<SystemConfigResponse, unknown>,
) => AsyncResult.isSuccess(config) && config.value.pro.isServerKeyValidated;
