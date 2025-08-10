use std::sync::Arc;

use anyhow::Result;
use chrono::Utc;
use common_utils::ryot_log;
use database_models::{
    collection_to_entity, monitored_entity, notification_platform,
    prelude::{CollectionToEntity, MonitoredEntity, NotificationPlatform},
};
use dependent_core_utils::get_entity_details_frontend_url;
use enum_models::{EntityLot, UserNotificationContent};
use itertools::Itertools;
use media_models::UpdateMediaEntityResult;
use notification_service::send_notification;
use sea_orm::{
    ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QuerySelect, prelude::Expr,
};
use supporting_service::SupportingService;
use traits::TraceOk;
use uuid::Uuid;

use crate::metadata_operations::{update_metadata, update_metadata_group, update_person};

pub async fn get_users_and_cte_monitoring_entity(
    entity_id: &String,
    entity_lot: EntityLot,
    db: &DatabaseConnection,
) -> Result<Vec<(String, Uuid)>> {
    let all_entities = MonitoredEntity::find()
        .select_only()
        .column(monitored_entity::Column::UserId)
        .column(monitored_entity::Column::CollectionToEntityId)
        .filter(monitored_entity::Column::EntityId.eq(entity_id))
        .filter(monitored_entity::Column::EntityLot.eq(entity_lot))
        .into_tuple::<(String, Uuid)>()
        .all(db)
        .await?;
    Ok(all_entities)
}

pub async fn get_users_monitoring_entity(
    entity_id: &String,
    entity_lot: EntityLot,
    db: &DatabaseConnection,
) -> Result<Vec<String>> {
    Ok(
        get_users_and_cte_monitoring_entity(entity_id, entity_lot, db)
            .await?
            .into_iter()
            .map(|(u, _)| u)
            .collect_vec(),
    )
}

async fn get_notification_message(
    change: UserNotificationContent,
    ss: &Arc<SupportingService>,
) -> Result<String> {
    match change {
        UserNotificationContent::ReviewPosted {
            entity_id,
            entity_title,
            entity_lot,
            triggered_by_username,
        } => {
            let url = get_entity_details_frontend_url(entity_id, entity_lot, Some("reviews"), ss);
            Ok(format!(
                "New review posted for {} ({}, {}) by {}.",
                entity_title, entity_lot, url, triggered_by_username
            ))
        }
        UserNotificationContent::MetadataPublished {
            entity_id,
            entity_lot,
            show_extra,
            entity_title,
            podcast_extra,
        } => {
            let url = get_entity_details_frontend_url(entity_id, entity_lot, None, ss);
            Ok(if let Some((season, episode)) = show_extra {
                format!(
                    "S{}E{} of {} ({}) has been released today.",
                    season, episode, entity_title, url
                )
            } else if let Some(episode) = podcast_extra {
                format!(
                    "E{} of {} ({}) has been released today.",
                    episode, entity_title, url
                )
            } else {
                format!("{} ({}) has been released today.", entity_title, url)
            })
        }
        UserNotificationContent::NewWorkoutCreated {
            workout_id,
            workout_name,
        } => {
            let url = get_entity_details_frontend_url(workout_id, EntityLot::Workout, None, ss);
            Ok(format!("New workout created - {} ({})", workout_name, url))
        }
        UserNotificationContent::OutdatedSeenEntries {
            entity_lot,
            seen_state,
            entity_title,
            days_threshold,
            last_updated_on,
        } => Ok(format!(
            "{} ({}) has been kept {} for more than {} days. Last updated on: {}.",
            entity_title, entity_lot, seen_state, days_threshold, last_updated_on
        )),
        UserNotificationContent::MetadataStatusChanged {
            old_status,
            new_status,
            entity_title,
        } => Ok(format!(
            "Status of {} changed from {} to {}",
            entity_title, old_status, new_status
        )),
        UserNotificationContent::MetadataEpisodeReleased {
            entity_title,
            old_episode_count,
            new_episode_count,
            season_number,
        } => Ok(if let Some(season) = season_number {
            format!(
                "Number of episodes changed from {} to {} (Season {}) for {}",
                old_episode_count, new_episode_count, season, entity_title
            )
        } else {
            format!(
                "Number of episodes changed from {} to {} for {}",
                old_episode_count, new_episode_count, entity_title
            )
        }),
        UserNotificationContent::PersonMetadataAssociated {
            role,
            person_name,
            metadata_title,
        } => Ok(format!(
            "{} has been associated with {} as {}",
            person_name, metadata_title, role
        )),
        UserNotificationContent::MetadataReleaseDateChanged {
            entity_title,
            old_date,
            new_date,
            season_number,
            episode_number,
        } => Ok(
            if let (Some(season), Some(episode)) = (season_number, episode_number) {
                format!(
                    "Episode release date changed from {} to {} (S{}E{}) for {}",
                    old_date, new_date, season, episode, entity_title
                )
            } else {
                format!(
                    "Publish year changed from {} to {} for {}",
                    old_date, new_date, entity_title
                )
            },
        ),
        UserNotificationContent::MetadataEpisodeNameChanged {
            entity_title,
            old_name,
            new_name,
            season_number,
            episode_number,
        } => Ok(if let Some(season) = season_number {
            format!(
                "Episode name changed from {} to {} (S{}E{}) for {}",
                old_name, new_name, season, episode_number, entity_title
            )
        } else {
            format!(
                "Episode name changed from {} to {} (EP{}) for {}",
                old_name, new_name, episode_number, entity_title
            )
        }),
        UserNotificationContent::MetadataEpisodeImagesChanged {
            entity_title,
            season_number,
            episode_number,
        } => Ok(if let Some(season) = season_number {
            format!(
                "Episode image changed for S{}E{} in {}",
                season, episode_number, entity_title
            )
        } else {
            format!(
                "Episode image changed for EP{} in {}",
                episode_number, entity_title
            )
        }),
        UserNotificationContent::PersonMetadataGroupAssociated {
            role,
            person_name,
            metadata_group_title,
        } => Ok(format!(
            "{} has been associated with {} as {}",
            person_name, metadata_group_title, role
        )),
        UserNotificationContent::MetadataNumberOfSeasonsChanged {
            entity_title,
            old_seasons,
            new_seasons,
        } => Ok(format!(
            "Number of seasons changed from {} to {} for {}",
            old_seasons, new_seasons, entity_title
        )),
        UserNotificationContent::MetadataChaptersOrEpisodesChanged {
            entity_title,
            old_count,
            new_count,
            content_type,
        } => Ok(format!(
            "Number of {} changed from {} to {} for {}",
            content_type, old_count, new_count, entity_title
        )),
        UserNotificationContent::NotificationFromReminderCollection { reminder_text } => {
            Ok(reminder_text)
        }
        UserNotificationContent::IntegrationDisabledDueToTooManyErrors { provider_name } => {
            Ok(format!(
                "Integration {} has been disabled due to too many errors",
                provider_name
            ))
        }
    }
}

pub async fn send_notification_for_user(
    user_id: &String,
    ss: &Arc<SupportingService>,
    notification: UserNotificationContent,
) -> Result<()> {
    let notification_platforms = NotificationPlatform::find()
        .filter(notification_platform::Column::UserId.eq(user_id))
        .filter(
            notification_platform::Column::IsDisabled
                .is_null()
                .or(notification_platform::Column::IsDisabled.eq(false)),
        )
        .all(&ss.db)
        .await?;
    for platform in notification_platforms {
        let not = notification.clone().into();
        if !platform.configured_events.contains(&not) {
            ryot_log!(
                debug,
                "Skipping sending notification to user: {} for platform: {} since it is not configured for this event",
                user_id,
                platform.lot,
            );
            continue;
        }
        let msg = get_notification_message(notification.clone(), ss).await?;
        if let Err(err) = send_notification(platform.platform_specifics, &msg).await {
            ryot_log!(trace, "Error sending notification: {:?}", err);
        }
    }
    Ok(())
}

pub async fn refresh_collection_to_entity_association(
    cte_id: &Uuid,
    db: &DatabaseConnection,
) -> Result<()> {
    ryot_log!(
        debug,
        "Refreshing collection to entity association for id = {cte_id}"
    );
    CollectionToEntity::update_many()
        .col_expr(
            collection_to_entity::Column::LastUpdatedOn,
            Expr::value(Utc::now()),
        )
        .filter(collection_to_entity::Column::Id.eq(cte_id.to_owned()))
        .exec(db)
        .await?;
    Ok(())
}

pub async fn update_metadata_and_notify_users(
    metadata_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let result = update_metadata(metadata_id, ss).await?;
    if !result.notifications.is_empty() {
        let users_to_notify =
            get_users_and_cte_monitoring_entity(metadata_id, EntityLot::Metadata, &ss.db).await?;
        for notification in result.notifications.iter() {
            for (user_id, cte_id) in users_to_notify.iter() {
                send_notification_for_user(user_id, ss, notification.clone())
                    .await
                    .trace_ok();
                refresh_collection_to_entity_association(cte_id, &ss.db)
                    .await
                    .trace_ok();
            }
        }
    }
    Ok(result)
}

pub async fn update_person_and_notify_users(
    person_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let result = update_person(person_id.clone(), ss).await?;
    if !result.notifications.is_empty() {
        let users_to_notify =
            get_users_and_cte_monitoring_entity(person_id, EntityLot::Person, &ss.db).await?;
        for notification in result.notifications.iter() {
            for (user_id, cte_id) in users_to_notify.iter() {
                send_notification_for_user(user_id, ss, notification.clone())
                    .await
                    .trace_ok();
                refresh_collection_to_entity_association(cte_id, &ss.db)
                    .await
                    .trace_ok();
            }
        }
    }
    Ok(result)
}

pub async fn update_metadata_group_and_notify_users(
    metadata_group_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<UpdateMediaEntityResult> {
    let result = update_metadata_group(metadata_group_id, ss).await?;
    if !result.notifications.is_empty() {
        let users_to_notify = get_users_and_cte_monitoring_entity(
            metadata_group_id,
            EntityLot::MetadataGroup,
            &ss.db,
        )
        .await?;
        for notification in result.notifications.iter() {
            for (user_id, cte_id) in users_to_notify.iter() {
                send_notification_for_user(user_id, ss, notification.clone())
                    .await
                    .trace_ok();
                refresh_collection_to_entity_association(cte_id, &ss.db)
                    .await
                    .trace_ok();
            }
        }
    }
    Ok(result)
}
