use std::sync::Arc;

use anyhow::Result;
use application_utils::{
    get_current_date, get_podcast_episode_by_number, get_show_episode_by_numbers,
};
use chrono::NaiveDate;
use common_models::{ChangeCollectionToEntitiesInput, DefaultCollection, EntityToCollectionInput};
use common_utils::{SHOW_SPECIAL_SEASON_NAMES, ryot_log};
use database_models::{
    calendar_event::{self, Entity as CalendarEvent},
    collection_entity_membership::{self, Entity as CollectionEntityMembership},
    metadata::{self, Entity as Metadata},
};
use dependent_collection_utils::remove_entities_from_collection;
use dependent_notification_utils::{get_users_monitoring_entity, send_notification_for_user};
use enum_models::{EntityLot, UserNotificationContent};
use futures::TryStreamExt;
use itertools::Itertools;
use media_models::{
    SeenAnimeExtraInformation, SeenPodcastExtraInformation, SeenShowExtraInformation,
};
use sea_orm::{ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, ModelTrait, QueryFilter};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;

pub async fn recalculate_calendar_events(ss: &Arc<SupportingService>) -> Result<()> {
    let date_to_calculate_from = get_current_date(&ss.timezone).pred_opt().unwrap();

    let selected_metadata = Metadata::find()
        .filter(metadata::Column::LastUpdatedOn.gte(date_to_calculate_from))
        .filter(
            metadata::Column::IsPartial
                .eq(false)
                .or(metadata::Column::IsPartial.is_null()),
        );

    let mut meta_stream = selected_metadata.clone().stream(&ss.db).await?;
    let mut calendar_event_ids_to_delete = Vec::new();

    while let Some(meta) = meta_stream.try_next().await? {
        ryot_log!(trace, "Processing metadata id = {:#?}", meta.id);
        let calendar_events = meta.find_related(CalendarEvent).all(&ss.db).await?;
        for cal_event in calendar_events {
            let mut need_to_delete = true;
            if let Some(show) = cal_event.metadata_show_extra_information {
                if let Some(show_info) = &meta.show_specifics {
                    if let Some((season, ep)) =
                        get_show_episode_by_numbers(show_info, show.season, show.episode)
                    {
                        if !SHOW_SPECIAL_SEASON_NAMES.contains(&season.name.as_str()) {
                            if let Some(publish_date) = ep.publish_date {
                                if publish_date == cal_event.date {
                                    need_to_delete = false;
                                }
                            }
                        }
                    }
                }
            } else if let Some(podcast) = cal_event.metadata_podcast_extra_information {
                if let Some(podcast_info) = &meta.podcast_specifics {
                    if let Some(ep) = get_podcast_episode_by_number(podcast_info, podcast.episode) {
                        if ep.publish_date == cal_event.date {
                            need_to_delete = false;
                        }
                    }
                }
            } else if let Some(anime) = cal_event.metadata_anime_extra_information {
                if let Some(anime_info) = &meta.anime_specifics {
                    if let Some(schedule) = &anime_info.airing_schedule {
                        schedule.iter().for_each(|s| {
                            if Some(s.episode) == anime.episode
                                && s.airing_at == cal_event.timestamp
                            {
                                need_to_delete = false;
                            }
                        });
                    }
                }
            } else if let Some(date) = meta.publish_date {
                if cal_event.date == date {
                    need_to_delete = false;
                }
            };

            if need_to_delete {
                ryot_log!(
                    debug,
                    "Need to delete calendar event id = {:#?} since it is outdated",
                    cal_event.id
                );
                calendar_event_ids_to_delete.push(cal_event.id);
            }
        }
    }

    if !calendar_event_ids_to_delete.is_empty() {
        ryot_log!(
            debug,
            "Batch deleting {} calendar events",
            calendar_event_ids_to_delete.len()
        );
        CalendarEvent::delete_many()
            .filter(calendar_event::Column::Id.is_in(calendar_event_ids_to_delete))
            .exec(&ss.db)
            .await?;
    }

    ryot_log!(debug, "Finished deleting invalid calendar events");

    let mut metadata_stream = selected_metadata.stream(&ss.db).await?;

    let mut calendar_events_inserts = vec![];
    let mut metadata_updates = vec![];
    while let Some(meta) = metadata_stream.try_next().await? {
        let calendar_event_template = calendar_event::ActiveModel {
            metadata_id: ActiveValue::Set(Some(meta.id.clone())),
            ..Default::default()
        };
        if let Some(podcast_spec) = &meta.podcast_specifics {
            for episode in podcast_spec.episodes.iter() {
                let mut event = calendar_event_template.clone();
                event.timestamp =
                    ActiveValue::Set(episode.publish_date.and_hms_opt(0, 0, 0).unwrap());
                event.metadata_podcast_extra_information =
                    ActiveValue::Set(Some(SeenPodcastExtraInformation {
                        episode: episode.number,
                    }));
                calendar_events_inserts.push(event);
            }
        } else if let Some(show_spec) = &meta.show_specifics {
            for season in show_spec.seasons.iter() {
                if SHOW_SPECIAL_SEASON_NAMES.contains(&season.name.as_str()) {
                    continue;
                }
                for episode in season.episodes.iter() {
                    if let Some(date) = episode.publish_date {
                        let mut event = calendar_event_template.clone();
                        event.timestamp = ActiveValue::Set(date.and_hms_opt(0, 0, 0).unwrap());
                        event.metadata_show_extra_information =
                            ActiveValue::Set(Some(SeenShowExtraInformation {
                                season: season.season_number,
                                episode: episode.episode_number,
                            }));

                        calendar_events_inserts.push(event);
                    }
                }
            }
        } else if let Some(anime_spec) = &meta.anime_specifics {
            if let Some(schedule) = &anime_spec.airing_schedule {
                for episode in schedule.iter() {
                    let mut event = calendar_event_template.clone();
                    event.timestamp = ActiveValue::Set(episode.airing_at);
                    event.metadata_anime_extra_information =
                        ActiveValue::Set(Some(SeenAnimeExtraInformation {
                            episode: Some(episode.episode),
                        }));
                    calendar_events_inserts.push(event);
                }
            }
        } else if let Some(publish_date) = meta.publish_date {
            let mut event = calendar_event_template.clone();
            event.timestamp = ActiveValue::Set(publish_date.and_hms_opt(0, 0, 0).unwrap());
            calendar_events_inserts.push(event);
        };
        metadata_updates.push(meta.id.clone());
    }
    for cal_insert in calendar_events_inserts {
        ryot_log!(debug, "Inserting calendar event: {:?}", cal_insert);
        cal_insert.insert(&ss.db).await.ok();
    }
    ryot_log!(debug, "Finished updating calendar events");
    Ok(())
}

pub async fn notify_users_for_released_media(ss: &Arc<SupportingService>) -> Result<()> {
    let today = get_current_date(&ss.timezone);
    let calendar_events = CalendarEvent::find()
        .filter(calendar_event::Column::Date.eq(today))
        .find_also_related(Metadata)
        .all(&ss.db)
        .await?;
    let notifications = calendar_events
        .into_iter()
        .map(|(cal_event, meta)| {
            let meta = meta.unwrap();
            let show_extra = cal_event
                .metadata_show_extra_information
                .map(|show| (show.season, show.episode));
            let podcast_extra = cal_event
                .metadata_podcast_extra_information
                .map(|podcast| podcast.episode);
            let notification = UserNotificationContent::MetadataPublished {
                show_extra,
                podcast_extra,
                entity_title: meta.title,
                entity_id: meta.id.to_string(),
                entity_lot: EntityLot::Metadata,
            };
            (meta.id.to_string(), notification)
        })
        .collect_vec();
    for (metadata_id, notification) in notifications.into_iter() {
        let users_to_notify =
            get_users_monitoring_entity(&metadata_id, EntityLot::Metadata, &ss.db).await?;
        for user in users_to_notify {
            send_notification_for_user(&user, ss, notification.clone()).await?;
        }
    }
    Ok(())
}

pub async fn notify_users_for_pending_reminders(ss: &Arc<SupportingService>) -> Result<()> {
    #[derive(Debug, Serialize, Deserialize)]
    struct UserMediaReminder {
        text: String,
        reminder: NaiveDate,
    }
    for membership in CollectionEntityMembership::find()
        .filter(
            collection_entity_membership::Column::CollectionName
                .eq(DefaultCollection::Reminders.to_string()),
        )
        .all(&ss.db)
        .await?
    {
        if let Some(reminder) = membership.collection_to_entity_information {
            let reminder: UserMediaReminder =
                serde_json::from_str(&serde_json::to_string(&reminder)?)?;
            if get_current_date(&ss.timezone) == reminder.reminder {
                send_notification_for_user(
                    &membership.user_id,
                    ss,
                    UserNotificationContent::NotificationFromReminderCollection {
                        reminder_text: reminder.text.clone(),
                    },
                )
                .await?;
                remove_entities_from_collection(
                    &membership.user_id,
                    ChangeCollectionToEntitiesInput {
                        creator_user_id: membership.user_id.clone(),
                        collection_name: DefaultCollection::Reminders.to_string(),
                        entities: vec![EntityToCollectionInput {
                            information: None,
                            entity_lot: membership.entity_lot,
                            entity_id: membership.entity_id.clone(),
                        }],
                    },
                    ss,
                )
                .await?;
            }
        }
    }
    Ok(())
}
