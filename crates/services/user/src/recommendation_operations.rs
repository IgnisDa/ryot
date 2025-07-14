use std::{collections::HashSet, sync::Arc, time::Instant};

use async_graphql::Result;
use common_models::UserLevelCacheKey;
use common_utils::{MEDIA_SOURCES_WITHOUT_RECOMMENDATIONS, ryot_log};
use database_models::{
    metadata, metadata_to_metadata,
    prelude::{Metadata, MetadataToMetadata},
    user_to_entity,
};
use database_utils::user_by_id;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, ApplicationRecommendations, CachedResponse,
    UserMetadataRecommendationsResponse,
};
use dependent_utils::{generic_metadata, update_metadata_and_notify_users};
use enum_models::MetadataToMetadataRelation;
use itertools::Itertools;
use nanoid::nanoid;
use rand::seq::{IndexedRandom, SliceRandom};
use sea_orm::{
    ActiveValue, ColumnTrait, Condition, DatabaseBackend, EntityTrait, FromQueryResult, JoinType,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait, RelationTrait, Statement,
    prelude::Expr,
    sea_query::{Func, extension::postgres::PgExpr},
};
use supporting_service::SupportingService;
use user_models::DashboardElementLot;

async fn get_or_generate_recommendation_set(
    ss: &Arc<SupportingService>,
    user_id: &String,
) -> Result<ApplicationRecommendations> {
    let cc = &ss.cache_service;
    let key = ApplicationCacheKey::UserMetadataRecommendationsSet(UserLevelCacheKey {
        input: (),
        user_id: user_id.to_owned(),
    });

    if let Some((_, recommendations)) = cc
        .get_value::<ApplicationRecommendations>(key.clone())
        .await
    {
        return Ok(recommendations);
    }

    #[derive(Debug, FromQueryResult)]
    struct CustomQueryResponse {
        id: String,
    }

    let mut args = vec![user_id.into()];
    args.extend(
        MEDIA_SOURCES_WITHOUT_RECOMMENDATIONS
            .into_iter()
            .map(|s| s.into()),
    );

    let media_items = CustomQueryResponse::find_by_statement(Statement::from_sql_and_values(
        DatabaseBackend::Postgres,
        r#"
SELECT "m"."id"
FROM (
    SELECT "user_id", "metadata_id" FROM "user_to_entity"
    WHERE "user_id" = $1 AND "metadata_id" IS NOT NULL
) "sub"
JOIN "metadata" "m" ON "sub"."metadata_id" = "m"."id" AND "m"."source" NOT IN ($2, $3, $4, $5)
ORDER BY RANDOM() LIMIT 10;
        "#,
        args,
    ))
    .all(&ss.db)
    .await?;

    ryot_log!(
        debug,
        "Media items selected for recommendations: {:?}",
        media_items
    );

    let mut media_item_ids = vec![];
    for media in media_items.into_iter() {
        ryot_log!(debug, "Getting recommendations: {:?}", media);
        update_metadata_and_notify_users(&media.id, ss).await?;
        let recommendations = generic_metadata(&media.id, ss, None).await?.suggestions;
        ryot_log!(debug, "Found recommendations: {:?}", recommendations);
        for rec in recommendations {
            let relation = metadata_to_metadata::ActiveModel {
                to_metadata_id: ActiveValue::Set(rec.clone()),
                from_metadata_id: ActiveValue::Set(media.id.clone()),
                relation: ActiveValue::Set(MetadataToMetadataRelation::Suggestion),
                ..Default::default()
            };
            MetadataToMetadata::insert(relation)
                .on_conflict_do_nothing()
                .exec(&ss.db)
                .await
                .ok();
            media_item_ids.push(rec);
        }
    }

    ss.cache_service
        .set_key(
            key,
            ApplicationCacheValue::UserMetadataRecommendationsSet(media_item_ids.clone()),
        )
        .await?;

    Ok(media_item_ids)
}

async fn filter_and_select_recommendations(
    calculated_recommendations: ApplicationRecommendations,
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<UserMetadataRecommendationsResponse> {
    let preferences = user_by_id(user_id, ss).await?.preferences;
    let limit = preferences
        .general
        .dashboard
        .into_iter()
        .find(|d| d.section == DashboardElementLot::Recommendations)
        .unwrap()
        .num_elements
        .unwrap();
    let enabled = preferences.features_enabled.media.specific;
    let started_at = Instant::now();
    let mut recommendations = HashSet::new();

    for i in 0.. {
        let now = Instant::now();
        if recommendations.len() >= limit.try_into().unwrap()
            || now.duration_since(started_at).as_secs() > 5
        {
            break;
        }
        ryot_log!(debug, "Recommendations loop {} for user: {}", i, user_id);
        let selected_lot = enabled.choose(&mut rand::rng()).unwrap();
        let cloned_user_id = user_id.clone();
        let rec = Metadata::find()
            .select_only()
            .column(metadata::Column::Id)
            .filter(metadata::Column::Lot.eq(*selected_lot))
            .join(
                JoinType::LeftJoin,
                metadata::Relation::UserToEntity
                    .def()
                    .on_condition(move |_left, right| {
                        Condition::all().add(
                            Expr::col((right, user_to_entity::Column::UserId))
                                .eq(cloned_user_id.clone()),
                        )
                    }),
            )
            .filter(user_to_entity::Column::Id.is_null())
            .apply_if(
                (!calculated_recommendations.is_empty()).then_some(0),
                |query, _| query.filter(metadata::Column::Id.is_in(&calculated_recommendations)),
            )
            .order_by_desc(Expr::expr(Func::md5(
                Expr::col(metadata::Column::Title).concat(Expr::val(nanoid!(12))),
            )))
            .into_tuple::<String>()
            .one(&ss.db)
            .await?;
        if let Some(rec) = rec {
            recommendations.insert(rec);
        }
    }

    let mut recommendations = recommendations.into_iter().collect_vec();
    recommendations.shuffle(&mut rand::rng());
    Ok(recommendations)
}

pub async fn user_metadata_recommendations(
    ss: &Arc<SupportingService>,
    user_id: &String,
) -> Result<CachedResponse<UserMetadataRecommendationsResponse>> {
    let cc = &ss.cache_service;
    let metadata_recommendations_key =
        ApplicationCacheKey::UserMetadataRecommendations(UserLevelCacheKey {
            input: (),
            user_id: user_id.to_owned(),
        });

    if let Some((id, recommendations)) = cc
        .get_value::<UserMetadataRecommendationsResponse>(metadata_recommendations_key.clone())
        .await
    {
        return Ok(CachedResponse {
            cache_id: id,
            response: recommendations,
        });
    };
    let metadata_count = Metadata::find().count(&ss.db).await?;
    let recommendations = match metadata_count {
        0 => vec![],
        _ => {
            let calculated_recommendations =
                get_or_generate_recommendation_set(ss, user_id).await?;
            filter_and_select_recommendations(calculated_recommendations, user_id, ss).await?
        }
    };
    let cc = &ss.cache_service;
    let id = cc
        .set_key(
            metadata_recommendations_key,
            ApplicationCacheValue::UserMetadataRecommendations(recommendations.clone()),
        )
        .await?;
    Ok(CachedResponse {
        cache_id: id,
        response: recommendations,
    })
}
