use std::{collections::HashSet, sync::Arc, time::Instant};

use anyhow::Result;
use common_models::UserLevelCacheKey;
use common_utils::{MEDIA_SOURCES_WITHOUT_RECOMMENDATIONS, ryot_log};
use database_models::{
    metadata, metadata_to_metadata,
    prelude::{Metadata, MetadataToMetadata, UserToEntity},
    user_to_entity,
};
use database_utils::user_by_id;
use dependent_core_utils::is_server_key_validated;
use dependent_entity_utils::generic_metadata;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, ApplicationRecommendations, CachedResponse,
    UserMetadataRecommendationsResponse,
};
use dependent_notification_utils::update_metadata_and_notify_users;
use enum_models::MetadataToMetadataRelation;
use itertools::Itertools;
use nanoid::nanoid;
use rand::seq::{IndexedRandom, SliceRandom};
use sea_orm::{
    ActiveValue, ColumnTrait, Condition, EntityTrait, JoinType, PaginatorTrait, QueryFilter,
    QueryOrder, QuerySelect, QueryTrait, RelationTrait,
    prelude::Expr,
    sea_query::{Func, extension::postgres::PgExpr},
};
use supporting_service::SupportingService;
use user_models::DashboardElementLot;

async fn get_or_generate_recommendation_set(
    ss: &Arc<SupportingService>,
    user_id: &String,
) -> Result<ApplicationRecommendations> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserMetadataRecommendationsSet(UserLevelCacheKey {
            input: (),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserMetadataRecommendationsSet,
        || async {
            let media_items = Metadata::find()
                .select_only()
                .column(metadata::Column::Id)
                .inner_join(UserToEntity)
                .filter(user_to_entity::Column::UserId.eq(user_id.clone()))
                .filter(user_to_entity::Column::MetadataId.is_not_null())
                .filter(metadata::Column::Source.is_not_in(MEDIA_SOURCES_WITHOUT_RECOMMENDATIONS))
                .limit(10)
                .order_by(Expr::expr(Func::random()), sea_orm::Order::Asc)
                .into_tuple::<String>()
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
                update_metadata_and_notify_users(&media, ss).await?;
                let recommendations = generic_metadata(&media, ss, None).await?.suggestions;
                ryot_log!(debug, "Found recommendations: {:?}", recommendations);
                for rec in recommendations {
                    let relation = metadata_to_metadata::ActiveModel {
                        to_metadata_id: ActiveValue::Set(rec.clone()),
                        from_metadata_id: ActiveValue::Set(media.clone()),
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

            Ok(media_item_ids)
        },
    )
    .await
    .map(|c| c.response)
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
    let cached_response = cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserMetadataRecommendations(UserLevelCacheKey {
            input: (),
            user_id: user_id.to_owned(),
        }),
        ApplicationCacheValue::UserMetadataRecommendations,
        || async {
            if !is_server_key_validated(ss).await? {
                return Ok(vec![]);
            }
            let metadata_count = Metadata::find().count(&ss.db).await?;
            let recommendations = match metadata_count {
                0 => vec![],
                _ => {
                    let calculated_recommendations =
                        get_or_generate_recommendation_set(ss, user_id).await?;
                    filter_and_select_recommendations(calculated_recommendations, user_id, ss)
                        .await?
                }
            };
            Ok(recommendations)
        },
    )
    .await?;

    Ok(cached_response)
}
