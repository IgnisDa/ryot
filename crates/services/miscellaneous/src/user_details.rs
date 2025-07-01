use std::sync::Arc;

use application_utils::calculate_average_rating_for_user;
use async_graphql::{Error, Result};
use database_models::{
    functions::get_user_to_entity_association,
    prelude::{Metadata, Seen},
    seen,
};
use database_utils::{entity_in_collections_with_details, item_reviews};
use dependent_models::{UserMetadataDetails, UserMetadataGroupDetails, UserPersonDetails};
use dependent_utils::generic_metadata;
use dependent_utils::{get_entity_recently_consumed, is_metadata_finished_by_user};
use enum_models::{EntityLot, SeenState};
use futures::{TryFutureExt, try_join};
use itertools::Itertools;
use media_models::{
    UserMediaNextEntry, UserMetadataDetailsEpisodeProgress, UserMetadataDetailsShowSeasonProgress,
};
use rust_decimal_macros::dec;
use sea_orm::{ColumnTrait, EntityTrait, QuerySelect};
use supporting_service::SupportingService;

pub async fn user_metadata_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    metadata_id: String,
) -> Result<UserMetadataDetails> {
    let (
        media_details,
        collections,
        reviews,
        (_, history),
        seen_by,
        user_to_meta,
        is_recently_consumed,
    ) = try_join!(
        generic_metadata(&metadata_id, ss, None),
        entity_in_collections_with_details(&ss.db, &user_id, &metadata_id, EntityLot::Metadata),
        item_reviews(&user_id, &metadata_id, EntityLot::Metadata, true, ss),
        is_metadata_finished_by_user(&user_id, &metadata_id, &ss.db),
        Metadata::find_by_id(&metadata_id)
            .select_only()
            .column_as(seen::Column::Id.count(), "num_times_seen")
            .left_join(Seen)
            .into_tuple::<(i64,)>()
            .one(&ss.db)
            .map_err(|_| Error::new("Metadata not found")),
        get_user_to_entity_association(&ss.db, &user_id, &metadata_id, EntityLot::Metadata),
        get_entity_recently_consumed(&user_id, &metadata_id, EntityLot::Metadata, ss)
    )?;

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
        has_interacted: user_to_meta.is_some(),
        media_reason: user_to_meta.and_then(|n| n.media_reason),
        seen_by_all_count: seen_by.map(|s| s.0).unwrap_or_default(),
    })
}

pub async fn user_person_details(
    ss: &Arc<SupportingService>,
    user_id: String,
    person_id: String,
) -> Result<UserPersonDetails> {
    let (reviews, collections, is_recently_consumed, person_meta) = try_join!(
        item_reviews(&user_id, &person_id, EntityLot::Person, true, ss),
        entity_in_collections_with_details(&ss.db, &user_id, &person_id, EntityLot::Person),
        get_entity_recently_consumed(&user_id, &person_id, EntityLot::Person, ss),
        get_user_to_entity_association(&ss.db, &user_id, &person_id, EntityLot::Person)
    )?;
    let average_rating = calculate_average_rating_for_user(&user_id, &reviews);
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
    let (collections, reviews, is_recently_consumed, metadata_group_meta) = try_join!(
        entity_in_collections_with_details(
            &ss.db,
            &user_id,
            &metadata_group_id,
            EntityLot::MetadataGroup,
        ),
        item_reviews(
            &user_id,
            &metadata_group_id,
            EntityLot::MetadataGroup,
            true,
            ss,
        ),
        get_entity_recently_consumed(&user_id, &metadata_group_id, EntityLot::MetadataGroup, ss),
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
        is_recently_consumed,
        has_interacted: metadata_group_meta.is_some(),
    })
}
