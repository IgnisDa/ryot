import { getAdminAccessToken } from "~/support/harness-target";

export const adminAccessTokenHeaders = (token: string) => ({ "Admin-Access-Token": token });

export const adminHeaders = () => adminAccessTokenHeaders(getAdminAccessToken());
