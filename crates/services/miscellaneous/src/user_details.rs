use std::sync::Arc;

use application_utils::calculate_average_rating;
use async_graphql::Result;
use database_models::functions::get_user_to_entity_association;
use database_utils::{entity_in_collections, item_reviews};
use dependent_models::{UserMetadataDetails, UserMetadataGroupDetails, UserPersonDetails};
use dependent_utils::generic_metadata;
use dependent_utils::{get_entity_recently_consumed, is_metadata_finished_by_user};
use enum_models::{EntityLot, SeenState};
use itertools::Itertools;
use media_models::{
    UserMediaNextEntry, UserMetadataDetailsEpisodeProgress, UserMetadataDetailsShowSeasonProgress,
};
use migrations::{AliasedMetadata, AliasedSeen};
use rust_decimal_macros::dec;
use sea_orm::{ConnectionTrait, JoinType};
use sea_query::{Alias, Expr, Func, Query};
use supporting_service::SupportingService;

use crate::core_operations::get_db_stmt;

pub async fn user_metadata_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    metadata_id: String,
) -> Result<UserMetadataDetails> {
    let media_details = generic_metadata(&metadata_id, ss).await?;
    let collections =
        entity_in_collections(&ss.db, &user_id, &metadata_id, EntityLot::Metadata).await?;
    let reviews = item_reviews(&user_id, &metadata_id, EntityLot::Metadata, true, ss).await?;
    let (_, history) = is_metadata_finished_by_user(&user_id, &metadata_id, &ss.db).await?;
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
    let metadata_alias = Alias::new("m");
    let seen_alias = Alias::new("s");
    let seen_select = Query::select()
        .expr_as(
            Expr::col((metadata_alias.clone(), AliasedMetadata::Id)),
            Alias::new("metadata_id"),
        )
        .expr_as(
            Func::count(Expr::col((seen_alias.clone(), AliasedSeen::MetadataId))),
            Alias::new("num_times_seen"),
        )
        .from_as(AliasedMetadata::Table, metadata_alias.clone())
        .join_as(
            JoinType::LeftJoin,
            AliasedSeen::Table,
            seen_alias.clone(),
            Expr::col((metadata_alias.clone(), AliasedMetadata::Id))
                .equals((seen_alias.clone(), AliasedSeen::MetadataId)),
        )
        .and_where(Expr::col((metadata_alias.clone(), AliasedMetadata::Id)).eq(&metadata_id))
        .group_by_col((metadata_alias.clone(), AliasedMetadata::Id))
        .to_owned();
    let stmt = get_db_stmt(seen_select);
    let seen_by = ss
        .db
        .query_one(stmt)
        .await?
        .map(|qr| qr.try_get_by_index::<i64>(1).unwrap())
        .unwrap();
    let seen_by: usize = seen_by.try_into().unwrap();
    let user_to_meta =
        get_user_to_entity_association(&ss.db, &user_id, &metadata_id, EntityLot::Metadata).await;
    let average_rating = calculate_average_rating(&reviews);
    let seen_by_user_count = history.len();
    let show_progress = if let Some(show_specifics) = media_details.model.show_specifics {
        let mut seasons = vec![];
        for season in show_specifics.seasons {
            let mut episodes = vec![];
            for episode in season.episodes {
                let seen = history
                    .iter()
                    .filter(|h| {
                        h.show_extra_information.as_ref().is_some_and(|s| {
                            s.season == season.season_number && s.episode == episode.episode_number
                        })
                    })
                    .collect_vec();
                episodes.push(UserMetadataDetailsEpisodeProgress {
                    episode_number: episode.episode_number,
                    times_seen: seen.len(),
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
    } else {
        None
    };
    let podcast_progress = if let Some(podcast_specifics) = media_details.model.podcast_specifics {
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
                episode_number: episode.number,
                times_seen: seen.len(),
            })
        }
        Some(episodes)
    } else {
        None
    };
    let is_recently_consumed =
        get_entity_recently_consumed(&user_id, &metadata_id, EntityLot::Metadata, ss).await?;
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
        is_recently_consumed,
        seen_by_all_count: seen_by,
        has_interacted: user_to_meta.is_some(),
        media_reason: user_to_meta.and_then(|n| n.media_reason),
    })
}

pub async fn user_person_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    person_id: String,
) -> Result<UserPersonDetails> {
    let reviews = item_reviews(&user_id, &person_id, EntityLot::Person, true, ss).await?;
    let collections =
        entity_in_collections(&ss.db, &user_id, &person_id, EntityLot::Person).await?;
    let is_recently_consumed =
        get_entity_recently_consumed(&user_id, &person_id, EntityLot::Person, ss).await?;
    let person_meta =
        get_user_to_entity_association(&ss.db, &user_id, &person_id, EntityLot::Person).await;
    let average_rating = calculate_average_rating(&reviews);
    Ok(UserPersonDetails {
        reviews,
        collections,
        average_rating,
        is_recently_consumed,
        has_interacted: person_meta.is_some(),
    })
}

pub async fn user_metadata_group_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    metadata_group_id: String,
) -> Result<UserMetadataGroupDetails> {
    let collections = entity_in_collections(
        &ss.db,
        &user_id,
        &metadata_group_id,
        EntityLot::MetadataGroup,
    )
    .await?;
    let reviews = item_reviews(
        &user_id,
        &metadata_group_id,
        EntityLot::MetadataGroup,
        true,
        ss,
    )
    .await?;
    let is_recently_consumed =
        get_entity_recently_consumed(&user_id, &metadata_group_id, EntityLot::MetadataGroup, ss)
            .await?;
    let average_rating = calculate_average_rating(&reviews);
    let metadata_group_meta = get_user_to_entity_association(
        &ss.db,
        &user_id,
        &metadata_group_id,
        EntityLot::MetadataGroup,
    )
    .await;
    Ok(UserMetadataGroupDetails {
        reviews,
        collections,
        average_rating,
        is_recently_consumed,
        has_interacted: metadata_group_meta.is_some(),
    })
}
