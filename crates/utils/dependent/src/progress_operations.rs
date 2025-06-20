use std::sync::Arc;

use async_graphql::{Error, Result};
use background_models::{ApplicationJob, LpApplicationJob};
use chrono::Utc;
use common_models::UserLevelCacheKey;
use common_utils::ryot_log;
use database_models::{metadata, prelude::*, seen};
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, EmptyCacheValue, ExpireCacheKeyInput,
};
use enum_models::{EntityLot, MediaLot, SeenState};
use futures::join;
use media_models::{
    ImportOrExportMetadataItemSeen, MetadataProgressUpdateCacheInput, MetadataProgressUpdateChange,
    MetadataProgressUpdateChangeCreateNewCompletedInput,
    MetadataProgressUpdateChangeLatestInProgressInput, MetadataProgressUpdateCommonInput,
    MetadataProgressUpdateInput, MetadataProgressUpdateNewInProgressInput,
    MetadataProgressUpdateStartedAndFinishedOnDateInput,
    MetadataProgressUpdateStartedOrFinishedOnDateInput, SeenAnimeExtraInformation,
    SeenMangaExtraInformation, SeenPodcastExtraInformation, SeenShowExtraInformation,
};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::prelude::DateTimeUtc;
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use supporting_service::SupportingService;

use crate::{
    seen_operations::handle_after_metadata_seen_tasks,
    utility_operations::mark_entity_as_recently_consumed,
};

pub async fn commit_import_seen_item(
    is_import: bool,
    user_id: &String,
    metadata_id: &String,
    ss: &Arc<SupportingService>,
    input: ImportOrExportMetadataItemSeen,
) -> Result<()> {
    let common = MetadataProgressUpdateCommonInput {
        show_season_number: input.show_season_number,
        provider_watched_on: input.provider_watched_on,
        manga_volume_number: input.manga_volume_number,
        show_episode_number: input.show_episode_number,
        anime_episode_number: input.anime_episode_number,
        manga_chapter_number: input.manga_chapter_number,
        podcast_episode_number: input.podcast_episode_number,
    };
    if is_import {
        let change_inner = match (input.started_on, input.ended_on) {
            (Some(started_on), Some(finished_on)) => {
                MetadataProgressUpdateChangeCreateNewCompletedInput::StartedAndFinishedOnDate(
                    MetadataProgressUpdateStartedAndFinishedOnDateInput {
                        started_on,
                        data: MetadataProgressUpdateStartedOrFinishedOnDateInput {
                            common,
                            timestamp: finished_on,
                        },
                    },
                )
            }
            (Some(started_on), None) => {
                MetadataProgressUpdateChangeCreateNewCompletedInput::StartedOnDate(
                    MetadataProgressUpdateStartedOrFinishedOnDateInput {
                        common,
                        timestamp: started_on,
                    },
                )
            }
            (None, Some(finished_on)) => {
                MetadataProgressUpdateChangeCreateNewCompletedInput::FinishedOnDate(
                    MetadataProgressUpdateStartedOrFinishedOnDateInput {
                        common,
                        timestamp: finished_on,
                    },
                )
            }
            (None, None) => {
                MetadataProgressUpdateChangeCreateNewCompletedInput::WithoutDates(common)
            }
        };
        let change = MetadataProgressUpdateChange::CreateNewCompleted(change_inner);
        metadata_progress_update(
            user_id,
            ss,
            MetadataProgressUpdateInput {
                change,
                metadata_id: metadata_id.to_owned(),
            },
        )
        .await?;
        return Ok(());
    }

    let common_input = UserLevelCacheKey {
        user_id: user_id.to_owned(),
        input: MetadataProgressUpdateCacheInput {
            common: common.clone(),
            metadata_id: metadata_id.to_owned(),
        },
    };
    let completed_cache_key =
        ApplicationCacheKey::MetadataProgressUpdateCompletedCache(common_input.clone());
    let in_progress_cache_key =
        ApplicationCacheKey::MetadataProgressUpdateInProgressCache(common_input);
    let cc = &ss.cache_service;
    let (in_progress_cache, completed_cache) = join!(
        cc.get_value::<EmptyCacheValue>(in_progress_cache_key.clone()),
        cc.get_value::<EmptyCacheValue>(completed_cache_key.clone()),
    );

    if completed_cache.is_some() {
        ryot_log!(debug, "Progress already completed for: {}", metadata_id);
        return Ok(());
    }

    if in_progress_cache.is_none() {
        ryot_log!(debug, "Creating new in-progress seen for: {}", metadata_id);
        let change = MetadataProgressUpdateChange::CreateNewInProgress(
            MetadataProgressUpdateNewInProgressInput {
                data: common,
                started_on: Utc::now(),
            },
        );
        metadata_progress_update(
            user_id,
            ss,
            MetadataProgressUpdateInput {
                change,
                metadata_id: metadata_id.to_owned(),
            },
        )
        .await?;

        cc.set_key(in_progress_cache_key, ApplicationCacheValue::MetadataProgressUpdateInProgressCache(EmptyCacheValue::default())).await?;
        return Ok(());
    }

    if let Some(progress) = input.progress {
        ryot_log!(debug, "Updating in-progress seen for: {}", metadata_id);
        let change = MetadataProgressUpdateChange::ChangeLatestInProgress(
            MetadataProgressUpdateChangeLatestInProgressInput::Progress(progress),
        );

        metadata_progress_update(
            user_id,
            ss,
            MetadataProgressUpdateInput {
                change,
                metadata_id: metadata_id.to_owned(),
            },
        )
        .await?;

        cc.expire_key(ExpireCacheKeyInput::ByKey(in_progress_cache_key))
            .await?;

        if progress >= dec!(100) {
            cc.set_key(
                completed_cache_key,
                ApplicationCacheValue::MetadataProgressUpdateCompletedCache(
                    EmptyCacheValue::default(),
                ),
            )
            .await?;
        }
    }

    Ok(())
}

#[derive(Debug)]
struct ExtraInformation {
    show_ei: Option<SeenShowExtraInformation>,
    anime_ei: Option<SeenAnimeExtraInformation>,
    manga_ei: Option<SeenMangaExtraInformation>,
    podcast_ei: Option<SeenPodcastExtraInformation>,
}

fn create_extra_information(
    media_lot: &MediaLot,
    payload: &MetadataProgressUpdateCommonInput,
) -> Result<ExtraInformation> {
    let show_ei = if matches!(media_lot, MediaLot::Show) {
        let season = payload
            .show_season_number
            .ok_or_else(|| Error::new("Season number is required for show progress update"))?;
        let episode = payload
            .show_episode_number
            .ok_or_else(|| Error::new("Episode number is required for show progress update"))?;
        Some(SeenShowExtraInformation { season, episode })
    } else {
        None
    };

    let podcast_ei = if matches!(media_lot, MediaLot::Podcast) {
        let episode = payload
            .podcast_episode_number
            .ok_or_else(|| Error::new("Episode number is required for podcast progress update"))?;
        Some(SeenPodcastExtraInformation { episode })
    } else {
        None
    };

    let anime_ei = if matches!(media_lot, MediaLot::Anime) {
        Some(SeenAnimeExtraInformation {
            episode: payload.anime_episode_number,
        })
    } else {
        None
    };

    let manga_ei = if matches!(media_lot, MediaLot::Manga) {
        Some(SeenMangaExtraInformation {
            volume: payload.manga_volume_number,
            chapter: payload.manga_chapter_number,
        })
    } else {
        None
    };

    Ok(ExtraInformation {
        show_ei,
        anime_ei,
        manga_ei,
        podcast_ei,
    })
}

struct CommitInput<'a> {
    state: SeenState,
    progress: Decimal,
    user_id: &'a String,
    meta: metadata::Model,
    started_on: Option<DateTimeUtc>,
    finished_on: Option<DateTimeUtc>,
    ss: &'a Arc<SupportingService>,
    payload: MetadataProgressUpdateCommonInput,
}

async fn commit(input: CommitInput<'_>) -> Result<seen::Model> {
    let extra_info = create_extra_information(&input.meta.lot, &input.payload)?;

    let seen_insert = seen::ActiveModel {
        state: ActiveValue::Set(input.state),
        progress: ActiveValue::Set(input.progress),
        started_on: ActiveValue::Set(input.started_on),
        finished_on: ActiveValue::Set(input.finished_on),
        user_id: ActiveValue::Set(input.user_id.to_owned()),
        metadata_id: ActiveValue::Set(input.meta.id.clone()),
        show_extra_information: ActiveValue::Set(extra_info.show_ei),
        anime_extra_information: ActiveValue::Set(extra_info.anime_ei),
        manga_extra_information: ActiveValue::Set(extra_info.manga_ei),
        podcast_extra_information: ActiveValue::Set(extra_info.podcast_ei),
        provider_watched_on: ActiveValue::Set(input.payload.provider_watched_on),
        ..Default::default()
    };
    let resp = seen_insert.insert(&input.ss.db).await?;
    ryot_log!(debug, "Created new seen: {:?}", resp);
    Ok(resp)
}

pub async fn metadata_progress_update(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: MetadataProgressUpdateInput,
) -> Result<()> {
    let meta = Metadata::find_by_id(&input.metadata_id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| Error::new("Metadata not found"))?;
    let previous_seen = Seen::find()
        .filter(seen::Column::Progress.lt(100))
        .filter(seen::Column::UserId.eq(user_id))
        .filter(seen::Column::State.ne(SeenState::Dropped))
        .filter(seen::Column::MetadataId.eq(&input.metadata_id))
        .order_by_desc(seen::Column::LastUpdatedOn)
        .one(&ss.db)
        .await?;
    ryot_log!(debug, "Metadata progress update: {:?}", input);
    let seen = match input.change {
        MetadataProgressUpdateChange::ChangeLatestInProgress(change_latest_in_progress) => {
            let Some(previous_seen) = previous_seen else {
                return Err(Error::new("No in progress seen found"));
            };
            let mut state;
            let mut progress = previous_seen.progress;
            let mut finished_on = previous_seen.finished_on;
            let mut updated_at = previous_seen.updated_at.clone();
            match change_latest_in_progress {
                MetadataProgressUpdateChangeLatestInProgressInput::State(new_state) => {
                    state = new_state;
                }
                MetadataProgressUpdateChangeLatestInProgressInput::Progress(new_progress) => {
                    if new_progress == progress {
                        return Err(Error::new("No progress update required"));
                    }
                    progress = new_progress;
                    state = SeenState::InProgress;
                    if new_progress >= dec!(100) {
                        progress = dec!(100);
                        state = SeenState::Completed;
                        finished_on = Some(Utc::now());
                    }
                }
            }
            updated_at.push(Utc::now());
            let mut last_seen: seen::ActiveModel = previous_seen.into();
            last_seen.state = ActiveValue::Set(state);
            last_seen.progress = ActiveValue::Set(progress);
            last_seen.updated_at = ActiveValue::Set(updated_at);
            last_seen.finished_on = ActiveValue::Set(finished_on);
            let resp = last_seen.update(&ss.db).await?;
            if resp.state == SeenState::Completed {
                ss.perform_application_job(ApplicationJob::Lp(
                    LpApplicationJob::HandleOnSeenComplete(resp.id.clone()),
                ))
                .await?;
            }
            resp
        }
        MetadataProgressUpdateChange::CreateNewInProgress(create_new_in_progress) => {
            if previous_seen.is_some() {
                return Err(Error::new(
                    "An in-progress record already exists for this metadata",
                ));
            };
            commit(CommitInput {
                ss,
                meta,
                user_id,
                progress: dec!(0),
                finished_on: None,
                state: SeenState::InProgress,
                payload: create_new_in_progress.data,
                started_on: Some(create_new_in_progress.started_on),
            })
            .await?
        }
        MetadataProgressUpdateChange::CreateNewCompleted(create_new_completed) => {
            let (started_on, finished_on, payload) = match create_new_completed {
                MetadataProgressUpdateChangeCreateNewCompletedInput::WithoutDates(inner_input) => {
                    (None, None, inner_input)
                }
                MetadataProgressUpdateChangeCreateNewCompletedInput::StartedOnDate(inner_input) => {
                    (Some(inner_input.timestamp), None, inner_input.common)
                }
                MetadataProgressUpdateChangeCreateNewCompletedInput::FinishedOnDate(
                    inner_input,
                ) => (None, Some(inner_input.timestamp), inner_input.common),
                MetadataProgressUpdateChangeCreateNewCompletedInput::StartedAndFinishedOnDate(
                    inner_input,
                ) => (
                    Some(inner_input.started_on),
                    Some(inner_input.data.timestamp),
                    inner_input.data.common,
                ),
            };
            commit(CommitInput {
                ss,
                meta,
                user_id,
                payload,
                started_on,
                finished_on,
                progress: dec!(100),
                state: SeenState::Completed,
            })
            .await?
        }
    };
    mark_entity_as_recently_consumed(user_id, &input.metadata_id, EntityLot::Metadata, ss).await?;
    handle_after_metadata_seen_tasks(seen, ss).await?;
    Ok(())
}
