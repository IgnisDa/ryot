use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use background_models::{ApplicationJob, LpApplicationJob};
use chrono::Utc;
use common_models::UserLevelCacheKey;
use database_models::{prelude::Seen, seen};
use dependent_details_utils::metadata_details;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, EmptyCacheValue, ExpireCacheKeyInput,
};
use dependent_seen_utils::handle_after_metadata_seen_tasks;
use enum_models::{MediaLot, SeenState};
use futures::{join, try_join};
use media_models::{
    ImportOrExportMetadataItemSeen, MetadataProgressUpdateCacheInput, MetadataProgressUpdateChange,
    MetadataProgressUpdateChangeCreateNewCompletedInput, MetadataProgressUpdateCommonInput,
    MetadataProgressUpdateInput, MetadataProgressUpdateNewInProgressInput,
    MetadataProgressUpdateStartedAndFinishedOnDateInput,
    MetadataProgressUpdateStartedOrFinishedOnDateInput, SeenAnimeExtraInformation,
    SeenMangaExtraInformation, SeenPodcastExtraInformation, SeenShowExtraInformation,
};
use rust_decimal::{Decimal, dec};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter,
    QueryOrder, QueryTrait, prelude::DateTimeUtc,
};
use supporting_service::SupportingService;
use uuid::Uuid;

// TEMP(1611): debug instrumentation for duplicate seen records; remove after investigation completes
pub async fn commit_import_seen_item(
    is_import: bool,
    user_id: &String,
    metadata_id: &String,
    ss: &Arc<SupportingService>,
    input: ImportOrExportMetadataItemSeen,
) -> Result<()> {
    let seen_execution_id = Uuid::new_v4();
    tracing::debug!(
        "[1611 SEEN {}] Starting commit_import_seen_item for metadata: {}, user: {}",
        seen_execution_id,
        metadata_id,
        user_id
    );
    let common = MetadataProgressUpdateCommonInput {
        manual_time_spent: input.manual_time_spent,
        show_season_number: input.show_season_number,
        manga_volume_number: input.manga_volume_number,
        show_episode_number: input.show_episode_number,
        anime_episode_number: input.anime_episode_number,
        manga_chapter_number: input.manga_chapter_number,
        providers_consumed_on: input.providers_consumed_on,
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
        tracing::debug!(
            "[1611 SEEN {}] Import path - calling metadata_progress_update for completed seen on {}",
            seen_execution_id,
            metadata_id
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
        tracing::debug!(
            "[1611 SEEN {}] Import path - metadata_progress_update finished for {}",
            seen_execution_id,
            metadata_id
        );
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
    tracing::debug!(
        "[1611 SEEN {}] Checking caches for metadata: {}",
        seen_execution_id,
        metadata_id
    );
    let (in_progress_cache, completed_cache) = join!(
        cache_service::get_value::<EmptyCacheValue>(ss, in_progress_cache_key.clone()),
        cache_service::get_value::<EmptyCacheValue>(ss, completed_cache_key.clone()),
    );
    tracing::debug!(
        "[1611 SEEN {}] Cache check results - in_progress: {}, completed: {}",
        seen_execution_id,
        in_progress_cache.is_some(),
        completed_cache.is_some()
    );

    if completed_cache.is_some() {
        tracing::debug!(
            "[1611 SEEN {}] Exiting early - progress already completed",
            seen_execution_id
        );
        return Ok(());
    }

    if in_progress_cache.is_none() {
        tracing::debug!(
            "[1611 SEEN {}] in_progress_cache is None, creating new in-progress seen",
            seen_execution_id
        );
        let change = MetadataProgressUpdateChange::CreateNewInProgress(
            MetadataProgressUpdateNewInProgressInput {
                data: common,
                started_on: Utc::now(),
            },
        );
        tracing::debug!(
            "[1611 SEEN {}] Calling metadata_progress_update for: {}",
            seen_execution_id,
            metadata_id
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
        tracing::debug!(
            "[1611 SEEN {}] metadata_progress_update completed successfully for: {}",
            seen_execution_id,
            metadata_id
        );

        cache_service::set_key(ss, in_progress_cache_key, ApplicationCacheValue::MetadataProgressUpdateInProgressCache(EmptyCacheValue::default())).await?;
        tracing::debug!(
            "[1611 SEEN {}] Completed commit_import_seen_item for: {}",
            seen_execution_id,
            metadata_id
        );
        return Ok(());
    }

    if let Some(progress) = input.progress {
        tracing::debug!(
            "[1611 SEEN {}] Updating in-progress seen for: {} with progress {}",
            seen_execution_id,
            metadata_id,
            progress
        );
        let change = MetadataProgressUpdateChange::ChangeLatestInProgress(progress);

        metadata_progress_update(
            user_id,
            ss,
            MetadataProgressUpdateInput {
                change,
                metadata_id: metadata_id.to_owned(),
            },
        )
        .await?;

        if progress >= dec!(100) {
            tracing::debug!(
                "[1611 SEEN {}] Progress >= 100, expiring in-progress cache and setting completed cache for {}",
                seen_execution_id,
                metadata_id
            );
            let _ = try_join!(
                cache_service::expire_key(
                    ss,
                    ExpireCacheKeyInput::ByKey(Box::new(in_progress_cache_key))
                ),
                cache_service::set_key(
                    ss,
                    completed_cache_key,
                    ApplicationCacheValue::MetadataProgressUpdateCompletedCache(
                        EmptyCacheValue::default(),
                    ),
                )
            );
            tracing::debug!(
                "[1611 SEEN {}] Cache transition to completed finished for {}",
                seen_execution_id,
                metadata_id
            );
        }
    } else {
        tracing::debug!(
            "[1611 SEEN {}] No progress provided; skipping in-progress update for {}",
            seen_execution_id,
            metadata_id
        );
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
    let show_ei = match media_lot {
        MediaLot::Show => {
            let season = payload
                .show_season_number
                .ok_or_else(|| anyhow!("Season number is required for show progress update"))?;
            let episode = payload
                .show_episode_number
                .ok_or_else(|| anyhow!("Episode number is required for show progress update"))?;
            Some(SeenShowExtraInformation { season, episode })
        }
        _ => None,
    };

    let podcast_ei = match media_lot {
        MediaLot::Podcast => {
            let episode = payload
                .podcast_episode_number
                .ok_or_else(|| anyhow!("Episode number is required for podcast progress update"))?;
            Some(SeenPodcastExtraInformation { episode })
        }
        _ => None,
    };

    let anime_ei = match media_lot {
        MediaLot::Anime => Some(SeenAnimeExtraInformation {
            episode: payload.anime_episode_number,
        }),
        _ => None,
    };

    let manga_ei = match media_lot {
        MediaLot::Manga => Some(SeenMangaExtraInformation {
            volume: payload.manga_volume_number,
            chapter: payload.manga_chapter_number,
        }),
        _ => None,
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
    metadata_lot: MediaLot,
    metadata_id: &'a String,
    ss: &'a Arc<SupportingService>,
    started_on: Option<DateTimeUtc>,
    finished_on: Option<DateTimeUtc>,
    payload: MetadataProgressUpdateCommonInput,
}

async fn commit(input: CommitInput<'_>) -> Result<seen::Model> {
    let extra_info = create_extra_information(&input.metadata_lot, &input.payload)?;

    let seen_insert = seen::ActiveModel {
        state: ActiveValue::Set(input.state),
        progress: ActiveValue::Set(input.progress),
        started_on: ActiveValue::Set(input.started_on),
        finished_on: ActiveValue::Set(input.finished_on),
        user_id: ActiveValue::Set(input.user_id.to_owned()),
        metadata_id: ActiveValue::Set(input.metadata_id.clone()),
        show_extra_information: ActiveValue::Set(extra_info.show_ei),
        anime_extra_information: ActiveValue::Set(extra_info.anime_ei),
        manga_extra_information: ActiveValue::Set(extra_info.manga_ei),
        podcast_extra_information: ActiveValue::Set(extra_info.podcast_ei),
        manual_time_spent: ActiveValue::Set(input.payload.manual_time_spent),
        providers_consumed_on: ActiveValue::Set(
            input.payload.providers_consumed_on.unwrap_or_default(),
        ),
        ..Default::default()
    };
    let resp = seen_insert.insert(&input.ss.db).await?;
    tracing::debug!("Created new seen: {:?}", resp);
    Ok(resp)
}

async fn get_previous_seen_item(
    user_id: &String,
    metadata_id: &String,
    no_progress_filter: bool,
    ss: &Arc<SupportingService>,
) -> Result<Option<seen::Model>> {
    let previous_seen_in_progress = Seen::find()
        .filter(seen::Column::UserId.eq(user_id))
        .filter(seen::Column::State.ne(SeenState::Dropped))
        .filter(seen::Column::MetadataId.eq(metadata_id))
        .apply_if(
            match no_progress_filter {
                true => None,
                false => Some(()),
            },
            |q, _v| q.filter(seen::Column::Progress.lt(100)),
        )
        .order_by_desc(seen::Column::LastUpdatedOn)
        .one(&ss.db)
        .await?;
    Ok(previous_seen_in_progress)
}

pub async fn metadata_progress_update(
    user_id: &String,
    ss: &Arc<SupportingService>,
    input: MetadataProgressUpdateInput,
) -> Result<()> {
    let progress_update_exec_id = Uuid::new_v4();
    tracing::debug!(
        "[1611 PROGRESS-UPD {}] Starting metadata_progress_update for {}, change={:?}",
        progress_update_exec_id,
        input.metadata_id,
        input.change
    );
    let meta = metadata_details(ss, &input.metadata_id).await?.response;
    tracing::debug!(
        "[1611 PROGRESS-UPD {}] metadata_progress_update input: {:?}",
        progress_update_exec_id,
        input
    );
    let seen = match input.change {
        MetadataProgressUpdateChange::ChangeLatestInProgress(new_progress) => {
            let previous_seen_in_progress =
                get_previous_seen_item(user_id, &input.metadata_id, false, ss).await?;
            let Some(previous_seen) = previous_seen_in_progress else {
                tracing::debug!(
                    "[1611 PROGRESS-UPD {}] No in-progress seen found for {} when trying to change progress",
                    progress_update_exec_id,
                    input.metadata_id
                );
                bail!("No in progress seen found");
            };
            let mut state;
            let mut progress = previous_seen.progress;
            let mut finished_on = previous_seen.finished_on;
            let mut updated_at = previous_seen.updated_at.clone();

            if new_progress == progress {
                tracing::debug!(
                    "[1611 PROGRESS-UPD {}] Incoming progress {} matches existing {}; aborting update",
                    progress_update_exec_id,
                    new_progress,
                    progress
                );
                bail!("Update progress is the same as current progress");
            }
            progress = new_progress;
            state = SeenState::InProgress;
            if new_progress >= dec!(100) {
                progress = dec!(100);
                state = SeenState::Completed;
                finished_on = Some(Utc::now());
            }

            updated_at.push(Utc::now());
            let mut last_seen = previous_seen.into_active_model();
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
        MetadataProgressUpdateChange::ChangeLatestState(new_state) => {
            let previous_seen =
                get_previous_seen_item(user_id, &input.metadata_id, true, ss).await?;
            let Some(previous_seen) = previous_seen else {
                tracing::debug!(
                    "[1611 PROGRESS-UPD {}] No in-progress seen found for {} when trying to change state",
                    progress_update_exec_id,
                    input.metadata_id
                );
                bail!("No in progress seen found");
            };
            let last_progress = previous_seen.progress;
            let mut updated_at = previous_seen.updated_at.clone();

            updated_at.push(Utc::now());
            let mut last_seen = previous_seen.into_active_model();
            last_seen.state = ActiveValue::Set(new_state);
            last_seen.updated_at = ActiveValue::Set(updated_at);
            if new_state == SeenState::OnAHold && last_progress == dec!(100) {
                last_seen.progress = ActiveValue::Set(dec!(99));
            }
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
            let previous_seen_in_progress =
                get_previous_seen_item(user_id, &input.metadata_id, false, ss).await?;
            if previous_seen_in_progress.is_some() {
                tracing::debug!(
                    "[1611 PROGRESS-UPD {}] In-progress record already exists for {}; refusing to create another",
                    progress_update_exec_id,
                    input.metadata_id
                );
                bail!("An in-progress record already exists for this metadata");
            };
            commit(CommitInput {
                ss,
                user_id,
                progress: dec!(0),
                finished_on: None,
                metadata_lot: meta.lot,
                state: SeenState::InProgress,
                metadata_id: &input.metadata_id,
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
                user_id,
                payload,
                started_on,
                finished_on,
                progress: dec!(100),
                metadata_lot: meta.lot,
                state: SeenState::Completed,
                metadata_id: &input.metadata_id,
            })
            .await?
        }
    };
    tracing::debug!(
        "[1611 PROGRESS-UPD {}] Seen change committed: {:?}",
        progress_update_exec_id,
        seen
    );
    handle_after_metadata_seen_tasks(seen, ss).await?;
    tracing::debug!(
        "[1611 PROGRESS-UPD {}] Progress update completed for {}",
        progress_update_exec_id,
        input.metadata_id
    );
    Ok(())
}
