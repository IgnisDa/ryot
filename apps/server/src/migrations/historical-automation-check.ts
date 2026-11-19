export const buildHistoricalAutomationCheckSql = () => `
DO $$
DECLARE
	trigger_rows bigint;
	recipient_rows bigint;
	run_rows bigint;
	attempt_rows bigint;
	notification_rows bigint;
	delivery_rows bigint;
BEGIN
	SELECT count(*) INTO trigger_rows FROM "automation_trigger";
	SELECT count(*) INTO recipient_rows FROM "automation_trigger_recipient";
	SELECT count(*) INTO run_rows FROM "automation_run";
	SELECT count(*) INTO attempt_rows FROM "automation_run_attempt";
	SELECT count(*) INTO notification_rows FROM "notification";
	SELECT count(*) INTO delivery_rows FROM "notification_delivery";

	IF trigger_rows <> 0 OR recipient_rows <> 0 OR run_rows <> 0 OR attempt_rows <> 0 THEN
		RAISE EXCEPTION 'legacy historical migration boundary: migration created automation execution history (% triggers, % recipients, % runs, % attempts), so startup cannot continue. Restore the V1 dump and report this migration defect.', trigger_rows, recipient_rows, run_rows, attempt_rows;
	END IF;
	IF notification_rows <> 0 OR delivery_rows <> 0 THEN
		RAISE EXCEPTION 'legacy historical migration boundary: migration created notification execution history (% notifications, % delivery attempts). Restore the V1 dump and report this migration defect.', notification_rows, delivery_rows;
	END IF;
END $$;
`;
