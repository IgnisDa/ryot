export const buildHistoricalEnrichmentCheckSql = () => `
DO $$
DECLARE
	request_rows bigint;
	translation_rows bigint;
	related_complete_rows bigint;
	related_active_rows bigint;
	invalid_generation_rows bigint;
BEGIN
	SELECT count(*) INTO request_rows FROM "entity_enrichment_request";
	SELECT count(*) INTO translation_rows FROM "entity_translation";
	SELECT count(*) INTO related_complete_rows FROM "entity" WHERE "related_populated_at" IS NOT NULL;
	SELECT count(*) INTO related_active_rows FROM "entity"
	WHERE "related_population_generation" IS NOT NULL OR "related_population_started_at" IS NOT NULL;
	SELECT count(*) INTO invalid_generation_rows FROM "entity" WHERE "content_generation" < 1;

	IF request_rows <> 0 OR translation_rows <> 0 OR related_complete_rows <> 0 OR related_active_rows <> 0 OR invalid_generation_rows <> 0 THEN
		RAISE EXCEPTION 'legacy historical enrichment boundary: found % enrichment requests, % translations, % entities marked related-complete, % entities with active related generations or start times, and % invalid content generations. Legacy data has no operational enrichment history, reusable translations, or proof of complete related sweeps; startup cannot continue. Restore the V1 dump and report this migration defect.', request_rows, translation_rows, related_complete_rows, related_active_rows, invalid_generation_rows;
	END IF;
END $$;
`;
