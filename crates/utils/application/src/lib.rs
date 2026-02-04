use std::sync::Arc;

use anyhow::Result;
use axum::{
    Extension, RequestPartsExt,
    extract::FromRequestParts,
    http::{StatusCode, header::AUTHORIZATION, request::Parts},
};
use chrono::{NaiveDate, NaiveDateTime, Utc};
use media_models::{
    GraphqlSortOrder, PodcastEpisode, PodcastSpecifics, ReviewItem, ShowEpisode, ShowSeason,
    ShowSpecifics,
};
use rust_decimal::Decimal;
use sea_orm::Order;
use supporting_service::SupportingService;

#[derive(Debug, Default)]
pub struct AuthContext {
    pub user_id: Option<String>,
    pub session_id: Option<String>,
}

impl<S> FromRequestParts<S> for AuthContext
where
    S: Send + Sync,
{
    type Rejection = (StatusCode, &'static str);

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let mut ctx = AuthContext {
            ..Default::default()
        };

        if let Some(h) = parts.headers.get(AUTHORIZATION) {
            ctx.session_id = h.to_str().map(|s| s.replace("Bearer ", "")).ok();
        } else if let Some(h) = parts.headers.get("x-auth-token") {
            ctx.session_id = h.to_str().map(String::from).ok();
        }
        if let Some(session_id) = ctx.session_id.as_ref() {
            let Extension(ss) = parts
                .extract::<Extension<Arc<SupportingService>>>()
                .await
                .map_err(|_| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Supporting service not available",
                    )
                })?;

            if let Ok(Some(session)) = session_service::validate_session(&ss, session_id).await {
                ctx.user_id = Some(session.user_id);
            }
        }

        Ok(ctx)
    }
}

pub fn get_current_time(timezone: &chrono_tz::Tz) -> NaiveDateTime {
    Utc::now().with_timezone(timezone).naive_local()
}

pub fn get_current_date(timezone: &chrono_tz::Tz) -> NaiveDate {
    get_current_time(timezone).date()
}

pub fn graphql_to_db_order(value: GraphqlSortOrder) -> Order {
    match value {
        GraphqlSortOrder::Desc => Order::Desc,
        GraphqlSortOrder::Asc => Order::Asc,
    }
}

pub fn get_show_episode_by_numbers(
    val: &ShowSpecifics,
    season_number: i32,
    episode_number: i32,
) -> Option<(&ShowSeason, &ShowEpisode)> {
    val.seasons
        .iter()
        .find(|s| s.season_number == season_number)
        .and_then(|s| {
            s.episodes
                .iter()
                .find(|e| e.episode_number == episode_number)
                .map(|e| (s, e))
        })
}

pub fn get_podcast_episode_by_number(
    val: &PodcastSpecifics,
    episode_number: i32,
) -> Option<&PodcastEpisode> {
    val.episodes.iter().find(|e| e.number == episode_number)
}

pub fn get_podcast_episode_number_by_name(val: &PodcastSpecifics, name: &str) -> Option<i32> {
    val.episodes
        .iter()
        .find(|e| e.title == name)
        .map(|e| e.number)
}

pub fn calculate_average_rating_for_user(
    user_id: &String,
    reviews: &[ReviewItem],
) -> Option<Decimal> {
    let (sum, count) = reviews
        .iter()
        .filter(|r| r.posted_by.id == *user_id && r.rating.is_some())
        .map(|r| r.rating.unwrap())
        .fold((Decimal::ZERO, 0), |(sum, count), rating| {
            (sum + rating, count + 1)
        });
    match count {
        0 => None,
        _ => Some(sum / Decimal::from(count)),
    }
}
