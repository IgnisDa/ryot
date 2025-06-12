use std::sync::Arc;

use application_utils::get_current_date;
use async_graphql::{Error, Result};
use background_models::{ApplicationJob, LpApplicationJob};
use chrono::{NaiveDate, Utc};
use common_utils::ryot_log;
use database_models::{
    metadata::Model,
    prelude::{Metadata, Seen},
    seen,
};
use enum_models::{EntityLot, MediaLot, SeenState};
use media_models::{
    MetadataProgressUpdateChange, MetadataProgressUpdateChangeCreateNewCompletedInput,
    MetadataProgressUpdateChangeLatestInProgressInput, MetadataProgressUpdateCommonInput,
    MetadataProgressUpdateInput, SeenAnimeExtraInformation, SeenMangaExtraInformation,
    SeenPodcastExtraInformation, SeenShowExtraInformation,
};
use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, QueryFilter, QueryOrder};
use supporting_service::SupportingService;

use crate::{
    expire_user_collections_list_cache, handle_after_metadata_seen_tasks,
    mark_entity_as_recently_consumed,
};

struct CommitInput<'a> {
    meta: Model,
    state: SeenState,
    progress: Decimal,
    user_id: &'a String,
    started_on: Option<NaiveDate>,
    finished_on: Option<NaiveDate>,
    ss: &'a Arc<SupportingService>,
    input: MetadataProgressUpdateCommonInput,
}

async fn commit(input: CommitInput<'_>) -> Result<seen::Model> {
    let show_ei = if matches!(input.meta.lot, MediaLot::Show) {
        let season = input
            .input
            .show_season_number
            .ok_or_else(|| Error::new("Season number is required for show progress update"))?;
        let episode = input
            .input
            .show_episode_number
            .ok_or_else(|| Error::new("Episode number is required for show progress update"))?;
        Some(SeenShowExtraInformation { season, episode })
    } else {
        None
    };
    let podcast_ei = if matches!(input.meta.lot, MediaLot::Podcast) {
        let episode = input
            .input
            .podcast_episode_number
            .ok_or_else(|| Error::new("Episode number is required for podcast progress update"))?;
        Some(SeenPodcastExtraInformation { episode })
    } else {
        None
    };
    let anime_ei = if matches!(input.meta.lot, MediaLot::Anime) {
        Some(SeenAnimeExtraInformation {
            episode: input.input.anime_episode_number,
        })
    } else {
        None
    };
    let manga_ei = if matches!(input.meta.lot, MediaLot::Manga) {
        Some(SeenMangaExtraInformation {
            chapter: input.input.manga_chapter_number,
            volume: input.input.manga_volume_number,
        })
    } else {
        None
    };
    let seen_insert = seen::ActiveModel {
        state: ActiveValue::Set(input.state),
        progress: ActiveValue::Set(input.progress),
        started_on: ActiveValue::Set(input.started_on),
        finished_on: ActiveValue::Set(input.finished_on),
        show_extra_information: ActiveValue::Set(show_ei),
        anime_extra_information: ActiveValue::Set(anime_ei),
        manga_extra_information: ActiveValue::Set(manga_ei),
        user_id: ActiveValue::Set(input.user_id.to_owned()),
        metadata_id: ActiveValue::Set(input.meta.id.clone()),
        podcast_extra_information: ActiveValue::Set(podcast_ei),
        provider_watched_on: ActiveValue::Set(input.input.provider_watched_on),
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
                        finished_on = Some(get_current_date(&ss.timezone));
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
                return Err(Error::new("Can't create new in progress seen"));
            };
            commit(CommitInput {
                ss,
                meta,
                user_id,
                progress: dec!(0),
                finished_on: None,
                state: SeenState::InProgress,
                input: create_new_in_progress.data,
                started_on: Some(create_new_in_progress.started_on),
            })
            .await?
        }
        MetadataProgressUpdateChange::CreateNewCompleted(create_new_completed) => {
            let (started_on, finished_on, input) = match create_new_completed {
                MetadataProgressUpdateChangeCreateNewCompletedInput::WithoutDates(inner_input) => {
                    (None, None, inner_input)
                }
                MetadataProgressUpdateChangeCreateNewCompletedInput::FinishedOnDate(
                    inner_input,
                ) => (None, Some(inner_input.finished_on), inner_input.common),
                MetadataProgressUpdateChangeCreateNewCompletedInput::StartedAndFinishedOnDate(
                    inner_input,
                ) => (
                    Some(inner_input.started_on),
                    Some(inner_input.data.finished_on),
                    inner_input.data.common,
                ),
            };
            commit(CommitInput {
                ss,
                meta,
                input,
                user_id,
                started_on,
                finished_on,
                progress: dec!(100),
                state: SeenState::Completed,
            })
            .await?
        }
    };
    mark_entity_as_recently_consumed(user_id, &input.metadata_id, EntityLot::Metadata, ss).await?;
    expire_user_collections_list_cache(user_id, ss).await?;
    handle_after_metadata_seen_tasks(seen, ss).await?;
    Ok(())
}
