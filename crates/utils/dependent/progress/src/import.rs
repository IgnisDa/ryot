use super::*;
use common_models::UserLevelCacheKey;
use dependent_models::{
    ApplicationCacheKey, ApplicationCacheValue, EmptyCacheValue, ExpireCacheKeyInput,
};

fn completed_change(
    started_on: Option<DateTimeUtc>,
    ended_on: Option<DateTimeUtc>,
    common: MetadataProgressUpdateCommonInput,
) -> MetadataProgressUpdateChangeCreateNewCompletedInput {
    match (started_on, ended_on) {
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
        (None, None) => MetadataProgressUpdateChangeCreateNewCompletedInput::WithoutDates(common),
    }
}

fn matches_episode(seen: &seen::Model, extra: &ExtraInformation) -> bool {
    seen.show_extra_information == extra.show_ei
        && seen.anime_extra_information == extra.anime_ei
        && seen.manga_extra_information == extra.manga_ei
        && seen.podcast_extra_information == extra.podcast_ei
}

pub async fn commit_import_seen_item(
    is_import: bool,
    user_id: &String,
    metadata_id: &String,
    ss: &Arc<SupportingService>,
    input: ImportOrExportMetadataItemSeen,
) -> Result<()> {
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
        return metadata_progress_update_inner(
            user_id,
            ss,
            MetadataProgressUpdateInput {
                metadata_id: metadata_id.clone(),
                change: MetadataProgressUpdateChange::CreateNewCompleted(completed_change(
                    input.started_on,
                    input.ended_on,
                    common,
                )),
            },
            None,
        )
        .await;
    }
    let meta = metadata_details(ss, metadata_id).await?.response;
    let extra = create_extra_information(&meta.lot, &common)?;
    let history = Seen::find()
        .filter(seen::Column::UserId.eq(user_id))
        .filter(seen::Column::MetadataId.eq(metadata_id))
        .filter(seen::Column::State.ne(SeenState::Dropped))
        .order_by_desc(seen::Column::LastUpdatedOn)
        .all(&ss.db)
        .await?;
    let (previous, has_completed) = matching_history(&history, &extra);
    let key = UserLevelCacheKey {
        user_id: user_id.clone(),
        input: MetadataProgressUpdateCacheInput {
            common: common.clone(),
            metadata_id: metadata_id.clone(),
        },
    };
    let completed_key = ApplicationCacheKey::MetadataProgressUpdateCompletedCache(key.clone());
    let in_progress_key = ApplicationCacheKey::MetadataProgressUpdateInProgressCache(key);
    if cache_service::get_value::<EmptyCacheValue>(ss, completed_key.clone())
        .await
        .is_some()
    {
        if has_completed {
            return Ok(());
        }
        cache_service::expire_key(
            ss,
            ExpireCacheKeyInput::ByKey(Box::new(completed_key.clone())),
        )
        .await?;
    }
    // History is authoritative; old cache markers can survive deleted records.
    cache_service::expire_key(ss, ExpireCacheKeyInput::ByKey(Box::new(in_progress_key))).await?;
    let finished = input.progress.is_some_and(|p| p >= dec!(100));
    let change = match &previous {
        Some(_) => {
            MetadataProgressUpdateChange::ChangeLatestInProgress(input.progress.unwrap_or_default())
        }
        None if finished => MetadataProgressUpdateChange::CreateNewCompleted(completed_change(
            input.started_on,
            input.ended_on,
            common.clone(),
        )),
        None => MetadataProgressUpdateChange::CreateNewInProgress(
            MetadataProgressUpdateNewInProgressInput {
                data: common,
                started_on: input.started_on.unwrap_or_else(Utc::now),
            },
        ),
    };
    if previous.is_some() && input.progress.is_none() {
        return Ok(());
    }
    metadata_progress_update_inner(
        user_id,
        ss,
        MetadataProgressUpdateInput {
            change,
            metadata_id: metadata_id.clone(),
        },
        Some(previous.clone()),
    )
    .await?;
    if previous.is_none() && !finished && input.progress.is_some_and(|p| p > dec!(0)) {
        let created = Seen::find()
            .filter(seen::Column::UserId.eq(user_id))
            .filter(seen::Column::MetadataId.eq(metadata_id))
            .order_by_desc(seen::Column::LastUpdatedOn)
            .all(&ss.db)
            .await?
            .into_iter()
            .find(|seen| seen.progress < dec!(100) && matches_episode(seen, &extra));
        metadata_progress_update_inner(
            user_id,
            ss,
            MetadataProgressUpdateInput {
                metadata_id: metadata_id.clone(),
                change: MetadataProgressUpdateChange::ChangeLatestInProgress(
                    input.progress.unwrap(),
                ),
            },
            Some(created),
        )
        .await?;
    }
    if finished {
        cache_service::set_key(
            ss,
            completed_key,
            ApplicationCacheValue::MetadataProgressUpdateCompletedCache(EmptyCacheValue::default()),
        )
        .await?;
    }
    Ok(())
}

fn matching_history(
    history: &[seen::Model],
    extra: &ExtraInformation,
) -> (Option<seen::Model>, bool) {
    let mut matching = history.iter().filter(|seen| matches_episode(seen, extra));
    let previous = matching
        .clone()
        .find(|seen| seen.progress < dec!(100))
        .cloned();
    let has_completed = matching.any(|seen| seen.state == SeenState::Completed);
    (previous, has_completed)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(episode: i32, completed: bool) -> seen::Model {
        seen::Model {
            id: episode.to_string(),
            user_id: "user".into(),
            metadata_id: "show".into(),
            num_times_updated: 0,
            review_id: None,
            updated_at: vec![],
            started_on: None,
            finished_on: None,
            manual_time_spent: None,
            providers_consumed_on: vec![],
            last_updated_on: Utc::now(),
            anime_extra_information: None,
            manga_extra_information: None,
            podcast_extra_information: None,
            progress: if completed { dec!(100) } else { dec!(25) },
            state: if completed {
                SeenState::Completed
            } else {
                SeenState::InProgress
            },
            show_extra_information: Some(SeenShowExtraInformation { season: 1, episode }),
        }
    }

    fn episode_two() -> ExtraInformation {
        ExtraInformation {
            anime_ei: None,
            manga_ei: None,
            podcast_ei: None,
            show_ei: Some(SeenShowExtraInformation {
                season: 1,
                episode: 2,
            }),
        }
    }

    #[test]
    fn newer_episode_does_not_receive_an_older_episodes_progress() {
        let (previous, completed) =
            matching_history(&[record(3, false), record(2, false)], &episode_two());
        assert_eq!(previous.unwrap().id, "2");
        assert!(!completed);
    }

    #[test]
    fn deleted_history_does_not_leave_authoritative_progress_state() {
        let (previous, completed) = matching_history(&[record(3, true)], &episode_two());
        assert!(previous.is_none());
        assert!(!completed);
        let (previous, completed) = matching_history(&[record(2, true)], &episode_two());
        assert!(previous.is_none());
        assert!(completed);
    }
}

pub async fn invalidate_seen_progress_cache(
    ss: &Arc<SupportingService>,
    seen: &seen::Model,
) -> Result<()> {
    use database_models::{application_cache, prelude::ApplicationCache};

    let entries = ApplicationCache::find()
        .filter(application_cache::Column::SanitizedKey.is_in([
            format!("MetadataProgressUpdateCompletedCache-{}", seen.user_id),
            format!("MetadataProgressUpdateInProgressCache-{}", seen.user_id),
        ]))
        .filter(application_cache::Column::ExpiresAt.gt(Utc::now()))
        .all(&ss.db)
        .await?;
    for entry in entries {
        let key = serde_json::from_str::<ApplicationCacheKey>(&entry.key)?;
        let input = match key {
            ApplicationCacheKey::MetadataProgressUpdateCompletedCache(key)
            | ApplicationCacheKey::MetadataProgressUpdateInProgressCache(key) => key,
            _ => continue,
        };
        let common = input.input.common;
        if input.user_id == seen.user_id
            && input.input.metadata_id == seen.metadata_id
            && seen
                .show_extra_information
                .as_ref()
                .map(|e| (e.season, e.episode))
                == common.show_season_number.zip(common.show_episode_number)
            && seen.podcast_extra_information.as_ref().map(|e| e.episode)
                == common.podcast_episode_number
            && seen
                .anime_extra_information
                .as_ref()
                .and_then(|e| e.episode)
                == common.anime_episode_number
            && seen
                .manga_extra_information
                .as_ref()
                .and_then(|e| e.chapter)
                == common.manga_chapter_number
            && seen.manga_extra_information.as_ref().and_then(|e| e.volume)
                == common.manga_volume_number
        {
            cache_service::expire_key(ss, ExpireCacheKeyInput::ById(entry.id)).await?;
        }
    }
    Ok(())
}
