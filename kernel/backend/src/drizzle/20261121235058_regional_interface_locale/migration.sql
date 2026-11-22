ALTER TABLE "user" DROP CONSTRAINT "user_preferences_check", ADD CONSTRAINT "user_preferences_check" CHECK (
		jsonb_typeof("preferences") = 'object'
		and "preferences" ?& array['contentLanguage', 'disableIntegrations', 'interfaceLocale', 'ratingScale', 'reportingTimeZone', 'weekStart']
		and "preferences" - 'contentLanguage' - 'disableIntegrations' - 'interfaceLocale' - 'ratingScale' - 'reportingTimeZone' - 'weekStart' = '{}'::jsonb
		and jsonb_typeof("preferences"->'disableIntegrations') = 'boolean'
		and "preferences"->>'ratingScale' in ('hundred', 'ten', 'five', 'three-point')
		and jsonb_typeof("preferences"->'reportingTimeZone') = 'string'
		and "preferences"->>'reportingTimeZone' <> ''
		and btrim("preferences"->>'reportingTimeZone') = "preferences"->>'reportingTimeZone'
		and (
			jsonb_typeof("preferences"->'interfaceLocale') = 'null'
			or (jsonb_typeof("preferences"->'interfaceLocale') = 'string'
				and "preferences"->>'interfaceLocale' ~ '^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$')
		)
		and (
			jsonb_typeof("preferences"->'contentLanguage') = 'null'
			or (jsonb_typeof("preferences"->'contentLanguage') = 'string'
				and "preferences"->>'contentLanguage' ~ '^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$')
		)
		and (
			jsonb_typeof("preferences"->'weekStart') = 'null'
			or "preferences"->'weekStart' in ('0', '1', '2', '3', '4', '5', '6')
		)
	);