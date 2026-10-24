ALTER TABLE "user" ALTER COLUMN "preferences" SET DEFAULT '{"language":null,"reportingTimeZone":null,"disableIntegrations":false}';--> statement-breakpoint
ALTER TABLE "user" DROP CONSTRAINT "user_preferences_check", ADD CONSTRAINT "user_preferences_check" CHECK (
		jsonb_typeof("preferences") = 'object'
		and "preferences" ?& array['disableIntegrations', 'language', 'reportingTimeZone']
		and "preferences" - 'disableIntegrations' - 'language' - 'reportingTimeZone' = '{}'::jsonb
		and jsonb_typeof("preferences"->'disableIntegrations') = 'boolean'
		and (
			jsonb_typeof("preferences"->'reportingTimeZone') = 'null'
			or (jsonb_typeof("preferences"->'reportingTimeZone') = 'string'
				and "preferences"->>'reportingTimeZone' <> ''
				and btrim("preferences"->>'reportingTimeZone') = "preferences"->>'reportingTimeZone')
		)
		and (
			jsonb_typeof("preferences"->'language') = 'null'
			or (jsonb_typeof("preferences"->'language') = 'string'
				and "preferences"->>'language' <> ''
				and btrim("preferences"->>'language', E' 	
') = "preferences"->>'language')
		)
	);