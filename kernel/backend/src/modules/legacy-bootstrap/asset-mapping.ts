const hasAssets = (assetsExpr: string) =>
	`${assetsExpr} IS NOT NULL AND ${assetsExpr} <> 'null'::jsonb`;

const buildLegacyStringAssetArraySql = (assetsExpr: string, field: string) => `CASE
	WHEN ${hasAssets(assetsExpr)}
	THEN (
		COALESCE(
			(
				SELECT jsonb_agg(
					jsonb_build_object('type', 'remote', 'url', remote_asset)
					ORDER BY ordinality
				)
				FROM jsonb_array_elements_text(COALESCE(${assetsExpr} -> 'remote_${field}', '[]'::jsonb))
					WITH ORDINALITY AS remote(remote_asset, ordinality)
			),
			'[]'::jsonb
		)
		||
		COALESCE(
			(
				SELECT jsonb_agg(
					jsonb_build_object('type', 's3', 'key', s3_asset)
					ORDER BY ordinality
				)
				FROM jsonb_array_elements_text(COALESCE(${assetsExpr} -> 's3_${field}', '[]'::jsonb))
					WITH ORDINALITY AS s3(s3_asset, ordinality)
			),
			'[]'::jsonb
		)
	)
	ELSE NULL
END`;

const buildLegacyRemoteVideoArraySql = (assetsExpr: string) => `CASE
	WHEN ${hasAssets(assetsExpr)}
	THEN (
		COALESCE(
			(
				SELECT jsonb_agg(
					jsonb_build_object('type', 'remote', 'url', remote_video.value ->> 'url')
					ORDER BY remote_video.ordinality
				)
				FROM jsonb_array_elements(COALESCE(${assetsExpr} -> 'remote_videos', '[]'::jsonb))
					WITH ORDINALITY AS remote_video(value, ordinality)
			),
			'[]'::jsonb
		)
		||
		COALESCE(
			(
				SELECT jsonb_agg(
					jsonb_build_object('type', 's3', 'key', s3_video)
					ORDER BY ordinality
				)
				FROM jsonb_array_elements_text(COALESCE(${assetsExpr} -> 's3_videos', '[]'::jsonb))
					WITH ORDINALITY AS s3(s3_video, ordinality)
			),
			'[]'::jsonb
		)
	)
	ELSE NULL
END`;

export const buildLegacyImagesSql = (assetsExpr: string) =>
	buildLegacyStringAssetArraySql(assetsExpr, "images");

export const buildLegacyVideosSql = (assetsExpr: string) =>
	`(${buildLegacyRemoteVideoArraySql(assetsExpr)} || ${buildLegacyStringAssetArraySql(assetsExpr, "videos")})`;
