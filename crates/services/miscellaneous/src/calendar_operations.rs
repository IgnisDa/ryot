use application_utils::get_current_date;
use application_utils::{get_podcast_episode_by_number, get_show_episode_by_numbers};
use async_graphql::Result;
use chrono::{Days, Timelike, Utc};
use common_utils::{SHOW_SPECIAL_SEASON_NAMES, get_first_and_last_day_of_month, ryot_log};
use database_models::{
    calendar_event::{self, Entity as CalendarEvent},
    metadata::{self, Entity as Metadata},
    prelude::CalendarEvent as CalendarEventEntity,
};
use database_utils::user_by_id;
use dependent_utils::get_users_monitoring_entity;
use dependent_utils::send_notification_for_user;
use enum_models::{EntityLot, UserNotificationContent};
use futures::TryStreamExt;
use itertools::Itertools;
use media_models::{
    GraphqlCalendarEvent, SeenAnimeExtraInformation, SeenPodcastExtraInformation,
    SeenShowExtraInformation,
};
use media_models::{GroupedCalendarEvent, UserCalendarEventInput, UserUpcomingCalendarEventInput};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, ModelTrait, QueryFilter,
    RelationTrait, StreamTrait,
};
use std::sync::Arc;
use supporting_service::SupportingService;
use user_models::DashboardElementLot;

pub async fn user_calendar_events(
    service: &crate::MiscellaneousService,
    user_id: String,
    input: UserCalendarEventInput,
) -> Result<Vec<GroupedCalendarEvent>> {
    let (start_date, end_date) = get_first_and_last_day_of_month(input.year, input.month);
    let events = service
        .get_calendar_events(user_id, false, Some(start_date), Some(end_date), None, None)
        .await?;
    let grouped_events = events
        .into_iter()
        .chunk_by(|event| event.date)
        .into_iter()
        .map(|(date, events)| GroupedCalendarEvent {
            date,
            events: events.collect(),
        })
        .collect();
    Ok(grouped_events)
}

pub async fn user_upcoming_calendar_events(
    service: &crate::MiscellaneousService,
    supporting_service: &std::sync::Arc<SupportingService>,
    user_id: String,
    input: UserUpcomingCalendarEventInput,
) -> Result<Vec<GraphqlCalendarEvent>> {
    let start_date = Utc::now().date_naive();
    let (media_limit, end_date) = match input {
        UserUpcomingCalendarEventInput::NextMedia(l) => (Some(l), None),
        UserUpcomingCalendarEventInput::NextDays(d) => {
            (None, start_date.checked_add_days(Days::new(d)))
        }
    };
    let preferences = user_by_id(&user_id, supporting_service)
        .await?
        .preferences
        .general;
    let element = preferences
        .dashboard
        .iter()
        .find(|e| matches!(e.section, DashboardElementLot::Upcoming));
    let events = service
        .get_calendar_events(
            user_id,
            true,
            Some(start_date),
            end_date,
            media_limit,
            element.and_then(|e| e.deduplicate_media),
        )
        .await?;
    Ok(events)
}

pub async fn recalculate_calendar_events(service: &SupportingService) -> Result<()> {
    let date_to_calculate_from = get_current_date(&service.timezone).pred_opt().unwrap();

    let selected_metadata = Metadata::find()
        .filter(metadata::Column::LastUpdatedOn.gte(date_to_calculate_from))
        .filter(
            metadata::Column::IsPartial
                .eq(false)
                .or(metadata::Column::IsPartial.is_null()),
        );

    let mut meta_stream = selected_metadata.clone().stream(&service.db).await?;

    while let Some(meta) = meta_stream.try_next().await? {
        ryot_log!(trace, "Processing metadata id = {:#?}", meta.id);
        let calendar_events = meta.find_related(CalendarEvent).all(&service.db).await?;
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
                CalendarEvent::delete_by_id(cal_event.id)
                    .exec(&service.db)
                    .await?;
            }
        }
    }

    ryot_log!(debug, "Finished deleting invalid calendar events");

    let mut metadata_stream = selected_metadata.stream(&service.db).await?;

    let mut calendar_events_inserts = vec![];
    let mut metadata_updates = vec![];
    while let Some(meta) = metadata_stream.try_next().await? {
        let calendar_event_template = calendar_event::ActiveModel {
            metadata_id: ActiveValue::Set(Some(meta.id.clone())),
            ..Default::default()
        };
        if let Some(ps) = &meta.podcast_specifics {
            for episode in ps.episodes.iter() {
                let mut event = calendar_event_template.clone();
                event.timestamp =
                    ActiveValue::Set(episode.publish_date.and_hms_opt(0, 0, 0).unwrap());
                event.metadata_podcast_extra_information =
                    ActiveValue::Set(Some(SeenPodcastExtraInformation {
                        episode: episode.number,
                    }));
                calendar_events_inserts.push(event);
            }
        } else if let Some(ss) = &meta.show_specifics {
            for season in ss.seasons.iter() {
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
        } else if let Some(ans) = &meta.anime_specifics {
            if let Some(schedule) = &ans.airing_schedule {
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
        cal_insert.insert(&service.db).await.ok();
    }
    ryot_log!(debug, "Finished updating calendar events");
    Ok(())
}

pub async fn queue_notifications_for_released_media(
    service: &Arc<SupportingService>,
    get_entity_details_frontend_url: impl Fn(String, EntityLot, Option<&str>) -> String,
) -> Result<()> {
    let today = get_current_date(&service.timezone);
    let calendar_events = CalendarEvent::find()
        .filter(calendar_event::Column::Date.eq(today))
        .find_also_related(Metadata)
        .all(&service.db)
        .await?;
    let notifications = calendar_events
        .into_iter()
        .map(|(cal_event, meta)| {
            let meta = meta.unwrap();
            let url =
                get_entity_details_frontend_url(meta.id.to_string(), EntityLot::Metadata, None);
            let notification = if let Some(show) = cal_event.metadata_show_extra_information {
                format!(
                    "S{}E{} of {} ({}) has been released today.",
                    show.season, show.episode, meta.title, url
                )
            } else if let Some(podcast) = cal_event.metadata_podcast_extra_information {
                format!(
                    "E{} of {} ({}) has been released today.",
                    podcast.episode, meta.title, url
                )
            } else {
                format!("{} ({}) has been released today.", meta.title, url)
            };
            (
                meta.id.to_string(),
                (notification, UserNotificationContent::MetadataPublished),
            )
        })
        .collect_vec();
    for (metadata_id, notification) in notifications.into_iter() {
        let users_to_notify =
            get_users_monitoring_entity(&metadata_id, EntityLot::Metadata, &service.db).await?;
        for user in users_to_notify {
            send_notification_for_user(&user, service, &notification).await?;
        }
    }
    Ok(())
}
