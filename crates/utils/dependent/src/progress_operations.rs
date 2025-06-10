use std::sync::Arc;

use application_utils::get_current_date;
use async_graphql::{Error, Result};
use background_models::{ApplicationJob, LpApplicationJob};
use chrono::Utc;
use common_models::{ProgressUpdateCacheInput, StringIdObject, UserLevelCacheKey};
use common_utils::ryot_log;
use database_models::{prelude::*, seen};
use dependent_models::{ApplicationCacheKey, ApplicationCacheValue, EmptyCacheValue};
use enum_models::{EntityLot, MediaLot, SeenState};
use media_models::{
    ProgressUpdateError, ProgressUpdateErrorVariant, ProgressUpdateInput,
    ProgressUpdateResultUnion, SeenAnimeExtraInformation, SeenMangaExtraInformation,
    SeenPodcastExtraInformation, SeenShowExtraInformation,
};
use rust_decimal_macros::dec;
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;

use crate::{
    deploy_after_metadata_seen_tasks, utility_operations::mark_entity_as_recently_consumed,
};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq, Copy)]
enum ProgressUpdateAction {
    Update,
    Now,
    InThePast,
    JustStarted,
    ChangeState,
}

pub async fn progress_update(
    user_id: &String,
    // update only if media has not been consumed for this user in the last `n` duration
    respect_cache: bool,
    input: ProgressUpdateInput,
    ss: &Arc<SupportingService>,
) -> Result<ProgressUpdateResultUnion> {
    let cache_and_lock_key = ApplicationCacheKey::ProgressUpdateCache(UserLevelCacheKey {
        user_id: user_id.to_owned(),
        input: ProgressUpdateCacheInput {
            metadata_id: input.metadata_id.clone(),
            show_season_number: input.show_season_number,
            show_episode_number: input.show_episode_number,
            manga_volume_number: input.manga_volume_number,
            manga_chapter_number: input.manga_chapter_number,
            anime_episode_number: input.anime_episode_number,
            podcast_episode_number: input.podcast_episode_number,
            provider_watched_on: input.provider_watched_on.clone(),
        },
    });
    if respect_cache {
        let in_cache = ss
            .cache_service
            .get_value::<EmptyCacheValue>(cache_and_lock_key.clone())
            .await;
        if in_cache.is_some() {
            ryot_log!(debug, "Seen is already in cache");
            return Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
                error: ProgressUpdateErrorVariant::AlreadySeen,
            }));
        }
    }
    ryot_log!(debug, "Input for progress_update = {:?}", input);

    let all_prev_seen = Seen::find()
        .filter(seen::Column::Progress.lt(100))
        .filter(seen::Column::UserId.eq(user_id))
        .filter(seen::Column::State.ne(SeenState::Dropped))
        .filter(seen::Column::MetadataId.eq(&input.metadata_id))
        .order_by_desc(seen::Column::LastUpdatedOn)
        .all(&ss.db)
        .await
        .unwrap();

    let action = match input.change_state {
        None => match input.progress {
            None => ProgressUpdateAction::ChangeState,
            Some(p) => {
                if p == dec!(100) {
                    match input.date {
                        None => ProgressUpdateAction::InThePast,
                        Some(u) => {
                            if get_current_date(&ss.timezone) == u {
                                if all_prev_seen.is_empty() {
                                    ProgressUpdateAction::Now
                                } else {
                                    ProgressUpdateAction::Update
                                }
                            } else {
                                ProgressUpdateAction::InThePast
                            }
                        }
                    }
                } else if all_prev_seen.is_empty() {
                    ProgressUpdateAction::JustStarted
                } else {
                    ProgressUpdateAction::Update
                }
            }
        },
        Some(_) => ProgressUpdateAction::ChangeState,
    };
    ryot_log!(debug, "Progress update action = {:?}", action);
    let err = || {
        Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
            error: ProgressUpdateErrorVariant::NoSeenInProgress,
        }))
    };
    let seen = match action {
        ProgressUpdateAction::Update => {
            let prev_seen = all_prev_seen[0].clone();
            let progress = input.progress.unwrap();
            let watched_on = prev_seen.provider_watched_on.clone();
            if prev_seen.progress == progress && watched_on == input.provider_watched_on {
                ryot_log!(debug, "No progress update required");
                return Ok(ProgressUpdateResultUnion::Error(ProgressUpdateError {
                    error: ProgressUpdateErrorVariant::UpdateWithoutProgressUpdate,
                }));
            }
            let mut updated_at = prev_seen.updated_at.clone();
            let now = Utc::now();
            if prev_seen.progress != progress {
                updated_at.push(now);
            }
            let mut last_seen: seen::ActiveModel = prev_seen.into();
            last_seen.state = ActiveValue::Set(SeenState::InProgress);
            last_seen.progress = ActiveValue::Set(progress);
            last_seen.updated_at = ActiveValue::Set(updated_at);
            last_seen.provider_watched_on =
                ActiveValue::Set(input.provider_watched_on.or(watched_on));

            // This is needed for manga as some of the apps will update in weird orders
            // For example with komga mihon will update out of order to the server
            if input.manga_chapter_number.is_some() {
                last_seen.manga_extra_information =
                    ActiveValue::set(Some(SeenMangaExtraInformation {
                        chapter: input.manga_chapter_number,
                        volume: input.manga_volume_number,
                    }))
            }

            let ls = last_seen.update(&ss.db).await.unwrap();
            mark_entity_as_recently_consumed(user_id, &input.metadata_id, EntityLot::Metadata, ss)
                .await?;
            ls
        }
        ProgressUpdateAction::ChangeState => {
            let new_state = input.change_state.unwrap_or(SeenState::Dropped);
            let last_seen = Seen::find()
                .filter(seen::Column::UserId.eq(user_id))
                .filter(seen::Column::MetadataId.eq(input.metadata_id.clone()))
                .order_by_desc(seen::Column::LastUpdatedOn)
                .one(&ss.db)
                .await
                .unwrap();
            match last_seen {
                Some(ls) => {
                    let watched_on = ls.provider_watched_on.clone();
                    let mut updated_at = ls.updated_at.clone();
                    let now = Utc::now();
                    updated_at.push(now);
                    let mut last_seen: seen::ActiveModel = ls.into();
                    last_seen.state = ActiveValue::Set(new_state);
                    last_seen.updated_at = ActiveValue::Set(updated_at);
                    last_seen.provider_watched_on =
                        ActiveValue::Set(input.provider_watched_on.or(watched_on));
                    last_seen.update(&ss.db).await.unwrap()
                }
                None => {
                    return err();
                }
            }
        }
        ProgressUpdateAction::Now
        | ProgressUpdateAction::InThePast
        | ProgressUpdateAction::JustStarted => {
            let meta = Metadata::find_by_id(&input.metadata_id)
                .one(&ss.db)
                .await
                .unwrap()
                .unwrap();
            ryot_log!(
                debug,
                "Progress update for meta {:?} ({:?})",
                meta.title,
                meta.lot
            );

            let show_ei = if matches!(meta.lot, MediaLot::Show) {
                let season = input.show_season_number.ok_or_else(|| {
                    Error::new("Season number is required for show progress update")
                })?;
                let episode = input.show_episode_number.ok_or_else(|| {
                    Error::new("Episode number is required for show progress update")
                })?;
                Some(SeenShowExtraInformation { season, episode })
            } else {
                None
            };
            let podcast_ei = if matches!(meta.lot, MediaLot::Podcast) {
                let episode = input.podcast_episode_number.ok_or_else(|| {
                    Error::new("Episode number is required for podcast progress update")
                })?;
                Some(SeenPodcastExtraInformation { episode })
            } else {
                None
            };
            let anime_ei = if matches!(meta.lot, MediaLot::Anime) {
                Some(SeenAnimeExtraInformation {
                    episode: input.anime_episode_number,
                })
            } else {
                None
            };
            let manga_ei = if matches!(meta.lot, MediaLot::Manga) {
                Some(SeenMangaExtraInformation {
                    chapter: input.manga_chapter_number,
                    volume: input.manga_volume_number,
                })
            } else {
                None
            };
            let finished_on = match action {
                ProgressUpdateAction::JustStarted => None,
                _ => input.date,
            };
            ryot_log!(debug, "Progress update finished on = {:?}", finished_on);
            let (progress, mut started_on) = match action {
                ProgressUpdateAction::JustStarted => {
                    mark_entity_as_recently_consumed(
                        user_id,
                        &input.metadata_id,
                        EntityLot::Metadata,
                        ss,
                    )
                    .await?;
                    (
                        input.progress.unwrap_or(dec!(0)),
                        Some(Utc::now().date_naive()),
                    )
                }
                _ => (dec!(100), None),
            };
            if matches!(action, ProgressUpdateAction::InThePast) && input.start_date.is_some() {
                started_on = input.start_date;
            }
            ryot_log!(debug, "Progress update percentage = {:?}", progress);
            let seen_insert = seen::ActiveModel {
                progress: ActiveValue::Set(progress),
                started_on: ActiveValue::Set(started_on),
                finished_on: ActiveValue::Set(finished_on),
                user_id: ActiveValue::Set(user_id.to_owned()),
                state: ActiveValue::Set(SeenState::InProgress),
                show_extra_information: ActiveValue::Set(show_ei),
                anime_extra_information: ActiveValue::Set(anime_ei),
                manga_extra_information: ActiveValue::Set(manga_ei),
                podcast_extra_information: ActiveValue::Set(podcast_ei),
                metadata_id: ActiveValue::Set(input.metadata_id.clone()),
                provider_watched_on: ActiveValue::Set(input.provider_watched_on),
                ..Default::default()
            };
            seen_insert.insert(&ss.db).await.unwrap()
        }
    };
    ryot_log!(debug, "Progress update = {:?}", seen);
    let id = seen.id.clone();
    if seen.state == SeenState::Completed && respect_cache {
        ss.cache_service
            .set_key(
                cache_and_lock_key,
                ApplicationCacheValue::ProgressUpdateCache(EmptyCacheValue::default()),
            )
            .await?;
    }
    if seen.state == SeenState::Completed {
        ss.perform_application_job(ApplicationJob::Lp(LpApplicationJob::HandleOnSeenComplete(
            seen.id.clone(),
        )))
        .await?;
    }
    deploy_after_metadata_seen_tasks(seen, ss).await?;
    Ok(ProgressUpdateResultUnion::Ok(StringIdObject { id }))
}
