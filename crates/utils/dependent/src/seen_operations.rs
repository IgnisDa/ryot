use std::{collections::HashMap, sync::Arc};

use async_graphql::Result;
use common_models::{ChangeCollectionToEntityInput, DefaultCollection};
use common_utils::SHOW_SPECIAL_SEASON_NAMES;
use database_models::{prelude::*, seen};
use dependent_models::{ApplicationCacheKeyDiscriminants, ExpireCacheKeyInput};
use enum_models::{EntityLot, MediaLot, SeenState};
use futures::try_join;
use itertools::Itertools;
use rust_decimal::{
    Decimal,
    prelude::{One, ToPrimitive},
};
use sea_orm::{ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder};
use supporting_service::SupportingService;

use crate::{
    collection_operations::{add_entity_to_collection, remove_entity_from_collection},
    utility_operations::{associate_user_with_entity, expire_user_collections_list_cache},
};

pub async fn seen_history(
    user_id: &String,
    metadata_id: &String,
    db: &DatabaseConnection,
) -> Result<Vec<seen::Model>> {
    let seen_items = Seen::find()
        .filter(seen::Column::UserId.eq(user_id))
        .filter(seen::Column::MetadataId.eq(metadata_id))
        .order_by_desc(seen::Column::LastUpdatedOn)
        .all(db)
        .await
        .unwrap();
    Ok(seen_items)
}

pub async fn is_metadata_finished_by_user(
    user_id: &String,
    metadata_id: &String,
    db: &DatabaseConnection,
) -> Result<(bool, Vec<seen::Model>)> {
    let metadata = Metadata::find_by_id(metadata_id)
        .one(db)
        .await
        .unwrap()
        .unwrap();
    let seen_history = seen_history(user_id, metadata_id, db).await?;
    let is_finished = if metadata.lot == MediaLot::Podcast
        || metadata.lot == MediaLot::Show
        || metadata.lot == MediaLot::Anime
        || metadata.lot == MediaLot::Manga
    {
        // DEV: If all episodes have been seen the same number of times, the media can be
        // considered finished.
        let all_episodes = if let Some(s) = metadata.show_specifics {
            s.seasons
                .into_iter()
                .filter(|s| !SHOW_SPECIAL_SEASON_NAMES.contains(&s.name.as_str()))
                .flat_map(|s| {
                    s.episodes
                        .into_iter()
                        .map(move |e| format!("{}-{}", s.season_number, e.episode_number))
                })
                .collect_vec()
        } else if let Some(p) = metadata.podcast_specifics {
            p.episodes
                .into_iter()
                .map(|e| format!("{}", e.number))
                .collect_vec()
        } else if let Some(e) = metadata.anime_specifics.and_then(|a| a.episodes) {
            (1..e + 1).map(|e| format!("{}", e)).collect_vec()
        } else if let Some(c) = metadata.manga_specifics.and_then(|m| m.chapters) {
            let one = Decimal::one();
            (0..c.to_u32().unwrap_or(0))
                .map(|i| Decimal::from(i) + one)
                .map(|d| d.to_string())
                .collect_vec()
        } else {
            vec![]
        };
        if all_episodes.is_empty() {
            return Ok((true, seen_history));
        }
        let mut bag =
            HashMap::<String, i32>::from_iter(all_episodes.iter().cloned().map(|e| (e, 0)));
        seen_history
            .clone()
            .into_iter()
            .map(|h| {
                if let Some(s) = h.show_extra_information {
                    format!("{}-{}", s.season, s.episode)
                } else if let Some(p) = h.podcast_extra_information {
                    format!("{}", p.episode)
                } else if let Some(a) = h.anime_extra_information.and_then(|a| a.episode) {
                    format!("{}", a)
                } else if let Some(m) = h.manga_extra_information.and_then(|m| m.chapter) {
                    format!("{}", m)
                } else {
                    String::new()
                }
            })
            .for_each(|ep| {
                bag.entry(ep).and_modify(|c| *c += 1);
            });
        let values = bag.values().cloned().collect_vec();

        let min_value = values.iter().min();
        let max_value = values.iter().max();

        match (min_value, max_value) {
            (Some(min), Some(max)) => min == max && *min != 0,
            _ => false,
        }
    } else {
        seen_history.iter().any(|h| h.state == SeenState::Completed)
    };
    Ok((is_finished, seen_history))
}

pub async fn handle_after_metadata_seen_tasks(
    seen: seen::Model,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let add_entity_to_collection = |collection_name: &str| {
        add_entity_to_collection(
            &seen.user_id,
            ChangeCollectionToEntityInput {
                creator_user_id: seen.user_id.clone(),
                collection_name: collection_name.to_string(),
                entity_id: seen.metadata_id.clone(),
                entity_lot: EntityLot::Metadata,
                ..Default::default()
            },
            ss,
        )
    };
    let remove_entity_from_collection = |collection_name: &str| {
        remove_entity_from_collection(
            &seen.user_id,
            ChangeCollectionToEntityInput {
                creator_user_id: seen.user_id.clone(),
                collection_name: collection_name.to_string(),
                entity_id: seen.metadata_id.clone(),
                entity_lot: EntityLot::Metadata,
                ..Default::default()
            },
            ss,
        )
    };
    let _ = try_join!(
        remove_entity_from_collection(&DefaultCollection::Watchlist.to_string()),
        associate_user_with_entity(&seen.user_id, &seen.metadata_id, EntityLot::Metadata, ss),
        expire_user_collections_list_cache(&seen.user_id, ss),
    );
    match seen.state {
        SeenState::InProgress => {
            for col in &[DefaultCollection::InProgress, DefaultCollection::Monitoring] {
                add_entity_to_collection(&col.to_string()).await.ok();
            }
        }
        SeenState::Dropped | SeenState::OnAHold => {
            remove_entity_from_collection(&DefaultCollection::InProgress.to_string())
                .await
                .ok();
        }
        SeenState::Completed => {
            let metadata = Metadata::find_by_id(&seen.metadata_id)
                .one(&ss.db)
                .await?
                .unwrap();
            if metadata.lot == MediaLot::Podcast
                || metadata.lot == MediaLot::Show
                || metadata.lot == MediaLot::Anime
                || metadata.lot == MediaLot::Manga
            {
                let (is_complete, _) =
                    is_metadata_finished_by_user(&seen.user_id, &seen.metadata_id, &ss.db).await?;
                if is_complete {
                    let _ = try_join!(
                        remove_entity_from_collection(&DefaultCollection::InProgress.to_string()),
                        add_entity_to_collection(&DefaultCollection::Completed.to_string()),
                    );
                } else {
                    for col in &[DefaultCollection::InProgress, DefaultCollection::Monitoring] {
                        add_entity_to_collection(&col.to_string()).await.ok();
                    }
                }
            } else {
                add_entity_to_collection(&DefaultCollection::Completed.to_string())
                    .await
                    .ok();
                for col in &[DefaultCollection::InProgress, DefaultCollection::Monitoring] {
                    remove_entity_from_collection(&col.to_string()).await.ok();
                }
            };
        }
    };
    ss.cache_service
        .expire_key(ExpireCacheKeyInput::BySanitizedKey {
            user_id: Some(seen.user_id),
            key: ApplicationCacheKeyDiscriminants::UserCollectionContents,
        })
        .await?;
    Ok(())
}
