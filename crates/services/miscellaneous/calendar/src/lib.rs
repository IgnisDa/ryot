use std::sync::Arc;

use anyhow::{Result, anyhow};
use application_utils::{get_podcast_episode_by_number, get_show_episode_by_numbers};
use chrono::{Days, NaiveDate, Utc};
use common_models::EntityAssets;
use common_utils::{get_db_stmt, get_first_and_last_day_of_month};
use database_models::{
    calendar_event,
    prelude::{CalendarEvent, Metadata, UserToEntity},
    user_to_entity,
};
use database_utils::user_by_id;
use enum_models::{MediaLot, UserToMediaReason};
use futures::{TryFutureExt, try_join};
use itertools::Itertools;
use media_models::{
    GraphqlCalendarEvent, PodcastSpecifics, SeenAnimeExtraInformation, SeenPodcastExtraInformation,
    SeenShowExtraInformation, ShowSpecifics,
};
use media_models::{GroupedCalendarEvent, UserCalendarEventInput, UserUpcomingCalendarEventInput};
use migrations_sql::{AliasedCalendarEvent, AliasedMetadata, AliasedUserToEntity};
use sea_orm::{
    ColumnTrait, EntityTrait, FromQueryResult, JoinType, Order, QueryFilter, QueryOrder,
    QuerySelect, QueryTrait,
    sea_query::{Alias, Asterisk, Condition, Expr, PgFunc, Query},
};
use supporting_service::SupportingService;
use user_models::DashboardElementLot;

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

async fn get_calendar_events(
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
            if let Some(sh) = evt.m_show_specifics
                && let Some((_, ep)) = get_show_episode_by_numbers(&sh, s.season, s.episode)
            {
                image = ep.poster_images.first().cloned();
                if show_spoilers_in_calendar {
                    calc.metadata_text = ep.name.clone();
                }
            }
            calc.show_extra_information = Some(s);
        } else if let Some(p) = evt.metadata_podcast_extra_information {
            if let Some(po) = evt.m_podcast_specifics
                && let Some(ep) = get_podcast_episode_by_number(&po, p.episode)
            {
                image = ep.thumbnail.clone();
                if show_spoilers_in_calendar {
                    calc.metadata_text = ep.title.clone();
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
