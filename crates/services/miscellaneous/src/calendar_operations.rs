use std::sync::Arc;

use anyhow::{Result, anyhow};
use application_utils::{
    get_current_date, get_podcast_episode_by_number, get_show_episode_by_numbers,
};
use chrono::{Days, NaiveDate, Utc};
use common_models::{
    ChangeCollectionToEntitiesInput, DefaultCollection, EntityAssets, EntityToCollectionInput,
};
use common_utils::{SHOW_SPECIAL_SEASON_NAMES, get_first_and_last_day_of_month, ryot_log};
use database_models::{
    calendar_event::{self, Entity as CalendarEvent},
    collection::{self, Entity as Collection},
    collection_to_entity::Entity as CollectionToEntity,
    metadata::{self, Entity as Metadata},
    prelude::UserToEntity,
    user_to_entity,
};
use database_utils::user_by_id;
use dependent_utils::{
    get_users_monitoring_entity, remove_entities_from_collection, send_notification_for_user,
};
use enum_models::{EntityLot, MediaLot, UserNotificationContent, UserToMediaReason};
use futures::{TryFutureExt, TryStreamExt, try_join};
use itertools::Itertools;
use media_models::{
    GraphqlCalendarEvent, PodcastSpecifics, SeenAnimeExtraInformation, SeenPodcastExtraInformation,
    SeenShowExtraInformation, ShowSpecifics,
};
use media_models::{GroupedCalendarEvent, UserCalendarEventInput, UserUpcomingCalendarEventInput};
use migrations::{AliasedCalendarEvent, AliasedMetadata, AliasedUserToEntity};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, FromQueryResult, JoinType, ModelTrait,
    Order, QueryFilter, QueryOrder, QuerySelect, QueryTrait,
};
use sea_query::{Alias, Asterisk, Condition, Expr, PgFunc, Query};
use serde::{Deserialize, Serialize};
use supporting_service::SupportingService;
use user_models::DashboardElementLot;

use crate::{core_operations::get_db_stmt, trending_and_events::get_entity_details_frontend_url};

pub async fn user_calendar_events(
    user_id: String,
    input: UserCalendarEventInput,
    ss: &Arc<SupportingService>,
) -> Result<Vec<GroupedCalendarEvent>> {
    let (start_date, end_date) = get_first_and_last_day_of_month(input.year, input.month);
    let events = get_calendar_events(
        ss,
        user_id,
        false,
        Some(start_date),
        Some(end_date),
        None,
        None,
    )
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
    ss: &Arc<SupportingService>,
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
    let preferences = user_by_id(&user_id, ss).await?.preferences.general;
    let element = preferences
        .dashboard
        .iter()
        .find(|e| matches!(e.section, DashboardElementLot::Upcoming));
    let events = get_calendar_events(
        ss,
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
        cal_insert.insert(&ss.db).await.ok();
    }
    ryot_log!(debug, "Finished updating calendar events");
    Ok(())
}

pub async fn queue_notifications_for_released_media(ss: &Arc<SupportingService>) -> Result<()> {
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
            let url =
                get_entity_details_frontend_url(meta.id.to_string(), EntityLot::Metadata, None, ss);
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
            get_users_monitoring_entity(&metadata_id, EntityLot::Metadata, &ss.db).await?;
        for user in users_to_notify {
            send_notification_for_user(&user, ss, &notification).await?;
        }
    }
    Ok(())
}

pub async fn get_calendar_events(
    ss: &Arc<SupportingService>,
    user_id: String,
    only_monitored: bool,
    start_date: Option<NaiveDate>,
    end_date: Option<NaiveDate>,
    media_limit: Option<u64>,
    deduplicate: Option<bool>,
) -> Result<Vec<GraphqlCalendarEvent>> {
    #[derive(Debug, FromQueryResult, Clone)]
    struct CalEvent {
        id: String,
        date: NaiveDate,
        m_lot: MediaLot,
        m_title: String,
        metadata_id: String,
        m_assets: EntityAssets,
        m_show_specifics: Option<ShowSpecifics>,
        m_podcast_specifics: Option<PodcastSpecifics>,
        metadata_show_extra_information: Option<SeenShowExtraInformation>,
        metadata_anime_extra_information: Option<SeenAnimeExtraInformation>,
        metadata_podcast_extra_information: Option<SeenPodcastExtraInformation>,
    }

    let stmt = Query::select()
        .column(Asterisk)
        .from_subquery(
            CalendarEvent::find()
                .apply_if(deduplicate.filter(|&d| d), |query, _v| {
                    query
                        .distinct_on([(
                            AliasedCalendarEvent::Table,
                            AliasedCalendarEvent::MetadataId,
                        )])
                        .order_by_asc(Expr::col((
                            AliasedCalendarEvent::Table,
                            AliasedCalendarEvent::MetadataId,
                        )))
                })
                .column_as(
                    Expr::col((AliasedMetadata::Table, AliasedMetadata::Lot)),
                    "m_lot",
                )
                .column_as(
                    Expr::col((AliasedMetadata::Table, AliasedMetadata::Title)),
                    "m_title",
                )
                .column_as(
                    Expr::col((AliasedMetadata::Table, AliasedMetadata::Assets)),
                    "m_assets",
                )
                .column_as(
                    Expr::col((AliasedMetadata::Table, AliasedMetadata::ShowSpecifics)),
                    "m_show_specifics",
                )
                .column_as(
                    Expr::col((AliasedMetadata::Table, AliasedMetadata::PodcastSpecifics)),
                    "m_podcast_specifics",
                )
                .filter(
                    Expr::col((AliasedUserToEntity::Table, AliasedUserToEntity::UserId))
                        .eq(&user_id),
                )
                .inner_join(Metadata)
                .join_rev(
                    JoinType::Join,
                    UserToEntity::belongs_to(CalendarEvent)
                        .from(user_to_entity::Column::MetadataId)
                        .to(calendar_event::Column::MetadataId)
                        .on_condition(move |left, _right| {
                            Condition::all().add_option(match only_monitored {
                                true => {
                                    Some(Expr::val(UserToMediaReason::Monitoring.to_string()).eq(
                                        PgFunc::any(Expr::col((
                                            left,
                                            user_to_entity::Column::MediaReason,
                                        ))),
                                    ))
                                }
                                false => None,
                            })
                        })
                        .into(),
                )
                .order_by_asc(calendar_event::Column::Date)
                .apply_if(start_date, |q, v| {
                    q.filter(calendar_event::Column::Date.gte(v))
                })
                .apply_if(end_date, |q, v| {
                    q.filter(calendar_event::Column::Date.lte(v))
                })
                .limit(media_limit)
                .into_query(),
            Alias::new("sub_query"),
        )
        .order_by(Alias::new("date"), Order::Asc)
        .to_owned();
    let (user, all_events) = try_join!(
        user_by_id(&user_id, ss),
        CalEvent::find_by_statement(get_db_stmt(stmt))
            .all(&ss.db)
            .map_err(|_| anyhow!("Failed to fetch calendar events"))
    )?;
    let show_spoilers_in_calendar = user.preferences.general.show_spoilers_in_calendar;
    let mut events = vec![];
    for evt in all_events {
        let mut calc = GraphqlCalendarEvent {
            date: evt.date,
            metadata_lot: evt.m_lot,
            calendar_event_id: evt.id,
            metadata_text: evt.m_title,
            metadata_id: evt.metadata_id,
            ..Default::default()
        };
        let mut image = None;

        if let Some(s) = evt.metadata_show_extra_information {
            if let Some(sh) = evt.m_show_specifics {
                if let Some((_, ep)) = get_show_episode_by_numbers(&sh, s.season, s.episode) {
                    image = ep.poster_images.first().cloned();
                    if show_spoilers_in_calendar {
                        calc.metadata_text = ep.name.clone();
                    }
                }
            }
            calc.show_extra_information = Some(s);
        } else if let Some(p) = evt.metadata_podcast_extra_information {
            if let Some(po) = evt.m_podcast_specifics {
                if let Some(ep) = get_podcast_episode_by_number(&po, p.episode) {
                    image = ep.thumbnail.clone();
                    if show_spoilers_in_calendar {
                        calc.metadata_text = ep.title.clone();
                    }
                }
            };
            calc.podcast_extra_information = Some(p);
        } else if let Some(a) = evt.metadata_anime_extra_information {
            calc.anime_extra_information = Some(a);
        };

        if image.is_none() {
            image = evt.m_assets.remote_images.first().cloned();
        }
        calc.metadata_image = image;
        events.push(calc);
    }
    Ok(events)
}

pub async fn queue_pending_reminders(ss: &Arc<SupportingService>) -> Result<()> {
    #[derive(Debug, Serialize, Deserialize)]
    #[serde(rename_all = "PascalCase")]
    struct UserMediaReminder {
        reminder: NaiveDate,
        text: String,
    }
    for (cte, col) in CollectionToEntity::find()
        .find_also_related(Collection)
        .filter(collection::Column::Name.eq(DefaultCollection::Reminders.to_string()))
        .all(&ss.db)
        .await?
    {
        if let Some(reminder) = cte.information {
            let reminder: UserMediaReminder =
                serde_json::from_str(&serde_json::to_string(&reminder)?)?;
            let col = col.unwrap();
            let related_users = col.find_related(UserToEntity).all(&ss.db).await?;
            if get_current_date(&ss.timezone) == reminder.reminder {
                for user in related_users {
                    send_notification_for_user(
                        &user.user_id,
                        ss,
                        &(
                            reminder.text.clone(),
                            UserNotificationContent::NotificationFromReminderCollection,
                        ),
                    )
                    .await?;
                    remove_entities_from_collection(
                        &user.user_id,
                        ChangeCollectionToEntitiesInput {
                            creator_user_id: col.user_id.clone(),
                            collection_name: DefaultCollection::Reminders.to_string(),
                            entities: vec![EntityToCollectionInput {
                                entity_id: cte.entity_id.clone(),
                                entity_lot: cte.entity_lot,
                                information: None,
                            }],
                        },
                        ss,
                    )
                    .await?;
                }
            }
        }
    }
    Ok(())
}
