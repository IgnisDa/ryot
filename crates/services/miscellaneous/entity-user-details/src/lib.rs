use std::sync::Arc;

use anyhow::{Result, anyhow};
use application_utils::calculate_average_rating_for_user;
use common_models::{EntityWithLot, UserLevelCacheKey};
use database_models::{
    entity_translation,
    functions::get_user_to_entity_association,
    prelude::{EntityTranslation, Metadata, Seen},
    seen,
};
use database_utils::{
    entity_in_collections_with_details, item_reviews, server_key_validation_guard,
};
use dependent_core_utils::is_server_key_validated;
use dependent_entity_utils::{generic_metadata, get_preferred_language_for_user_and_source};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, CachedResponse, EmptyCacheValue,
    UserMetadataDetails, UserMetadataGroupDetails, UserPersonDetails,
};
use dependent_seen_utils::is_metadata_finished_by_user;
use enum_models::{EntityLot, EntityTranslationVariant, MediaSource, SeenState};
use futures::{TryFutureExt, try_join};
use itertools::Itertools;
use media_models::{
    EntityTranslationDetails, UserMediaNextEntry, UserMetadataDetailsEpisodeProgress,
    UserMetadataDetailsShowSeasonProgress,
};
use rust_decimal::dec;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QuerySelect};
use supporting_service::SupportingService;

async fn get_entity_translations(
    user_id: &String,
    entity_id: &String,
    source: &MediaSource,
    ss: &Arc<SupportingService>,
) -> Result<EntityTranslationDetails> {
    let preferred_language =
        get_preferred_language_for_user_and_source(ss, user_id, source).await?;
    let translations = EntityTranslation::find()
        .filter(entity_translation::Column::MetadataId.eq(entity_id))
        .filter(entity_translation::Column::Language.eq(&preferred_language))
        .all(&ss.db)
        .await?;
    Ok(EntityTranslationDetails {
        title: translations
            .iter()
            .find(|s| s.variant == EntityTranslationVariant::Title)
            .and_then(|s| s.value.clone()),
        description: translations
            .iter()
            .find(|s| s.variant == EntityTranslationVariant::Description)
            .and_then(|s| s.value.clone()),
    })
}

pub async fn user_metadata_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    metadata_id: String,
) -> Result<CachedResponse<UserMetadataDetails>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserMetadataDetails(UserLevelCacheKey {
            user_id: user_id.clone(),
            input: metadata_id.clone(),
        }),
        |f| ApplicationCacheValue::UserMetadataDetails(Box::new(f)),
        || async {
            let (
                media_details,
                (_, history),
                reviews,
                collections,
                user_to_meta,
                seen_by,
            ) = try_join!(
                generic_metadata(&metadata_id, ss, None),
                is_metadata_finished_by_user(&user_id, &metadata_id, ss),
                item_reviews(&user_id, &metadata_id, EntityLot::Metadata, true, ss),
                entity_in_collections_with_details(&user_id, &metadata_id, EntityLot::Metadata, ss),
                get_user_to_entity_association(&ss.db, &user_id, &metadata_id, EntityLot::Metadata),
                Metadata::find_by_id(&metadata_id)
                    .select_only()
                    .column_as(seen::Column::Id.count(), "num_times_seen")
                    .left_join(Seen)
                    .into_tuple::<(i64,)>()
                    .one(&ss.db)
                    .map_err(|_| anyhow!("Metadata not found")),
                )?;


            let translated_details = get_entity_translations(
                &user_id,
                &metadata_id,
                &media_details.model.source,
                ss,
            )
            .await?;
            let in_progress = history
                .iter()
                .find(|h| h.state == SeenState::InProgress || h.state == SeenState::OnAHold)
                .cloned();
            let next_entry = history.first().and_then(|h| {
                if let Some(s) = &media_details.model.show_specifics {
                    let all_episodes = s
                        .seasons
                        .iter()
                        .map(|s| (s.season_number, &s.episodes))
                        .collect_vec()
                        .into_iter()
                        .flat_map(|(s, e)| {
                            e.iter().map(move |e| UserMediaNextEntry {
                                season: Some(s),
                                episode: Some(e.episode_number),
                                ..Default::default()
                            })
                        })
                        .collect_vec();
                    let next = all_episodes.iter().position(|e| {
                        e.season == Some(h.show_extra_information.as_ref().unwrap().season)
                            && e.episode == Some(h.show_extra_information.as_ref().unwrap().episode)
                    });
                    Some(all_episodes.get(next? + 1)?.clone())
                } else if let Some(p) = &media_details.model.podcast_specifics {
                    let all_episodes = p
                        .episodes
                        .iter()
                        .map(|e| UserMediaNextEntry {
                            episode: Some(e.number),
                            ..Default::default()
                        })
                        .collect_vec();
                    let next = all_episodes.iter().position(|e| {
                        e.episode == Some(h.podcast_extra_information.as_ref().unwrap().episode)
                    });
                    Some(all_episodes.get(next? + 1)?.clone())
                } else if let Some(_anime_spec) = &media_details.model.anime_specifics {
                    h.anime_extra_information.as_ref().and_then(|hist| {
                        hist.episode.map(|e| UserMediaNextEntry {
                            episode: Some(e + 1),
                            ..Default::default()
                        })
                    })
                } else if let Some(_manga_spec) = &media_details.model.manga_specifics {
                    h.manga_extra_information.as_ref().and_then(|hist| {
                        hist.chapter
                            .map(|e| UserMediaNextEntry {
                                chapter: Some(e.floor() + dec!(1)),
                                ..Default::default()
                            })
                            .or(hist.volume.map(|e| UserMediaNextEntry {
                                volume: Some(e + 1),
                                ..Default::default()
                            }))
                    })
                } else {
                    None
                }
            });
            let average_rating = calculate_average_rating_for_user(&user_id, &reviews);
            let seen_by_user_count = history.len();
            let show_progress = match media_details.model.show_specifics {
                Some(show_specifics) => {
                    let mut seasons = vec![];
                    for season in show_specifics.seasons {
                        let mut episodes = vec![];
                        for episode in season.episodes {
                            let seen = history
                                .iter()
                                .filter(|h| {
                                    h.show_extra_information.as_ref().is_some_and(|s| {
                                        s.season == season.season_number
                                            && s.episode == episode.episode_number
                                    })
                                })
                                .collect_vec();
                            episodes.push(UserMetadataDetailsEpisodeProgress {
                                times_seen: seen.len(),
                                episode_number: episode.episode_number,
                            })
                        }
                        let times_season_seen = episodes
                            .iter()
                            .map(|e| e.times_seen)
                            .min()
                            .unwrap_or_default();
                        seasons.push(UserMetadataDetailsShowSeasonProgress {
                            episodes,
                            times_seen: times_season_seen,
                            season_number: season.season_number,
                        })
                    }
                    Some(seasons)
                }
                None => None,
            };
            let podcast_progress =
                match media_details.model.podcast_specifics {
                    Some(podcast_specifics) => {
                        let mut episodes = vec![];
                        for episode in podcast_specifics.episodes {
                            let seen = history
                                .iter()
                                .filter(|h| {
                                    h.podcast_extra_information
                                        .as_ref()
                                        .is_some_and(|s| s.episode == episode.number)
                                })
                                .collect_vec();
                            episodes.push(UserMetadataDetailsEpisodeProgress {
                                times_seen: seen.len(),
                                episode_number: episode.number,
                            })
                        }
                        Some(episodes)
                    }
                    None => None,
                };
            Ok(UserMetadataDetails {
                reviews,
                history,
                next_entry,
                collections,
                in_progress,
                show_progress,
                average_rating,
                podcast_progress,
                seen_by_user_count,
                translated_details,
                has_interacted: user_to_meta.is_some(),
                media_reason: user_to_meta.and_then(|n| n.media_reason),
                seen_by_all_count: seen_by.map(|s| s.0).unwrap_or_default(),
            })
        },
    )
    .await
}

pub async fn user_person_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    person_id: String,
) -> Result<CachedResponse<UserPersonDetails>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserPersonDetails(UserLevelCacheKey {
            user_id: user_id.clone(),
            input: person_id.clone(),
        }),
        |f| ApplicationCacheValue::UserPersonDetails(Box::new(f)),
        || async {
            let (reviews, collections, person_meta) = try_join!(
                item_reviews(&user_id, &person_id, EntityLot::Person, true, ss),
                entity_in_collections_with_details(&user_id, &person_id, EntityLot::Person, ss),
                get_user_to_entity_association(&ss.db, &user_id, &person_id, EntityLot::Person)
            )?;
            let average_rating = calculate_average_rating_for_user(&user_id, &reviews);
            Ok(UserPersonDetails {
                reviews,
                collections,
                average_rating,
                has_interacted: person_meta.is_some(),
            })
        },
    )
    .await
}

pub async fn user_metadata_group_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    metadata_group_id: String,
) -> Result<CachedResponse<UserMetadataGroupDetails>> {
    cache_service::get_or_set_with_callback(
        ss,
        ApplicationCacheKey::UserMetadataGroupDetails(UserLevelCacheKey {
            user_id: user_id.clone(),
            input: metadata_group_id.clone(),
        }),
        |f| ApplicationCacheValue::UserMetadataGroupDetails(Box::new(f)),
        || async {
            let (collections, reviews, metadata_group_meta) = try_join!(
                entity_in_collections_with_details(
                    &user_id,
                    &metadata_group_id,
                    EntityLot::MetadataGroup,
                    ss
                ),
                item_reviews(
                    &user_id,
                    &metadata_group_id,
                    EntityLot::MetadataGroup,
                    true,
                    ss,
                ),
                get_user_to_entity_association(
                    &ss.db,
                    &user_id,
                    &metadata_group_id,
                    EntityLot::MetadataGroup,
                )
            )?;
            let average_rating = calculate_average_rating_for_user(&user_id, &reviews);
            Ok(UserMetadataGroupDetails {
                reviews,
                collections,
                average_rating,
                has_interacted: metadata_group_meta.is_some(),
            })
        },
    )
    .await
}

pub async fn get_entity_recently_consumed(
    user_id: &String,
    input: EntityWithLot,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    server_key_validation_guard(is_server_key_validated(ss).await?).await?;
    let is_recently_consumed = cache_service::get_value::<EmptyCacheValue>(
        ss,
        ApplicationCacheKey::EntityRecentlyConsumed(UserLevelCacheKey {
            input: input.clone(),
            user_id: user_id.to_owned(),
        }),
    )
    .await
    .is_some();
    Ok(is_recently_consumed)
}
