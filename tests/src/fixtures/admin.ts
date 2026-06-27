export const ADMIN_TOKEN = "test-admin-token";

export const adminAccessTokenHeaders = (token = ADMIN_TOKEN) => ({
	"Admin-Access-Token": token,
});

export const adminHeaders = adminAccessTokenHeaders();
