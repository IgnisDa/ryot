use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use background_models::{ApplicationJob, HpApplicationJob, LpApplicationJob};
use chrono::Utc;
use common_models::{BackendError, EntityAssets, StringIdAndNamedObject};
use common_utils::ryot_log;
use database_models::{
    access_link, collection, collection_entity_membership, collection_to_entity,
    prelude::{
        AccessLink, CollectionEntityMembership, CollectionToEntity, Review, Seen, User, Workout,
        WorkoutTemplate,
    },
    review, seen, user, workout,
};
use dependent_models::{
    CollectionToEntityDetails, GraphqlCollectionToEntityDetails, UserWorkoutDetails,
    UserWorkoutTemplateDetails,
};
use enum_models::{EntityLot, UserLot, Visibility};

use itertools::Itertools;
use markdown::to_html as markdown_to_html;
use media_models::{MediaCollectionFilter, MediaCollectionPresenceFilter, ReviewItem};
use migrations::AliasedCollectionToEntity;
use rust_decimal_macros::dec;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, IntoActiveModel,
    QueryFilter, QueryOrder, QuerySelect, QueryTrait, Select, prelude::Expr, sea_query::PgFunc,
};
use supporting_service::SupportingService;
use user_models::UserReviewScale;
use uuid::Uuid;

pub async fn revoke_access_link(db: &DatabaseConnection, access_link_id: String) -> Result<bool> {
    AccessLink::update(access_link::ActiveModel {
        id: ActiveValue::Set(access_link_id),
        is_revoked: ActiveValue::Set(Some(true)),
        ..Default::default()
    })
    .exec(db)
    .await?;
    Ok(true)
}

pub fn ilike_sql(value: &str) -> String {
    format!("%{value}%")
}

pub async fn user_by_id(user_id: &String, ss: &Arc<SupportingService>) -> Result<user::Model> {
    let user = User::find_by_id(user_id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| anyhow!("No user found"))?;
    Ok(user)
}

pub async fn admin_account_guard(user_id: &String, ss: &Arc<SupportingService>) -> Result<()> {
    let main_user = user_by_id(user_id, ss).await?;
    if main_user.lot != UserLot::Admin {
        bail!(BackendError::AdminOnlyAction.to_string());
    }
    Ok(())
}

pub async fn server_key_validation_guard(is_server_key_validated: bool) -> Result<()> {
    if !is_server_key_validated {
        bail!("This feature is only available on the Pro version",);
    }
    Ok(())
}

pub async fn entity_in_collections_with_collection_to_entity_ids(
    db: &DatabaseConnection,
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
) -> Result<Vec<(collection::Model, Uuid)>> {
    let details = entity_in_collections_with_details(db, user_id, entity_id, entity_lot).await?;
    Ok(details
        .into_iter()
        .map(|d| {
            (
                collection::Model {
                    id: d.details.collection_id.clone(),
                    name: d.details.collection_name.clone(),
                    ..Default::default()
                },
                d.id,
            )
        })
        .collect_vec())
}

pub async fn entity_in_collections_with_details(
    db: &DatabaseConnection,
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
) -> Result<Vec<GraphqlCollectionToEntityDetails>> {
    let memberships = CollectionEntityMembership::find()
        .filter(collection_entity_membership::Column::UserId.eq(user_id))
        .filter(collection_entity_membership::Column::EntityId.eq(entity_id))
        .filter(collection_entity_membership::Column::EntityLot.eq(entity_lot))
        .order_by_desc(collection_entity_membership::Column::CollectionToEntityLastUpdatedOn)
        .all(db)
        .await?;
    let resp = memberships
        .into_iter()
        .map(|membership| GraphqlCollectionToEntityDetails {
            id: membership.collection_to_entity_id,
            details: CollectionToEntityDetails {
                rank: membership.collection_to_entity_rank,
                creator_user_id: membership.user_id.clone(),
                collection_name: membership.collection_name.clone(),
                collection_id: membership.origin_collection_id.clone(),
                created_on: membership.collection_to_entity_created_on,
                information: membership.collection_to_entity_information,
                last_updated_on: membership.collection_to_entity_last_updated_on,
            },
        })
        .collect_vec();
    Ok(resp)
}

pub async fn user_workout_details(
    user_id: &String,
    workout_id: String,
    ss: &Arc<SupportingService>,
) -> Result<UserWorkoutDetails> {
    let maybe_workout = Workout::find_by_id(workout_id.clone())
        .filter(workout::Column::UserId.eq(user_id))
        .one(&ss.db)
        .await?;
    let Some(mut e) = maybe_workout else {
        bail!("Workout with the given ID could not be found for this user.");
    };
    let collections =
        entity_in_collections_with_details(&ss.db, user_id, &workout_id, EntityLot::Workout)
            .await?;
    let details = {
        if let Some(ref mut assets) = e.information.assets {
            transform_entity_assets(assets, ss).await?;
        }
        for exercise in e.information.exercises.iter_mut() {
            if let Some(ref mut assets) = exercise.assets {
                transform_entity_assets(assets, ss).await?;
            }
        }
        e
    };
    let metadata_consumed = Seen::find()
        .select_only()
        .column(seen::Column::MetadataId)
        .distinct()
        .filter(Expr::val(details.start_time).lte(PgFunc::any(Expr::col(seen::Column::UpdatedAt))))
        .filter(Expr::val(details.end_time).gte(PgFunc::any(Expr::col(seen::Column::UpdatedAt))))
        .into_tuple::<String>()
        .all(&ss.db)
        .await?;
    Ok(UserWorkoutDetails {
        details,
        collections,
        metadata_consumed,
    })
}

pub async fn user_workout_template_details(
    db: &DatabaseConnection,
    user_id: &String,
    workout_template_id: String,
) -> Result<UserWorkoutTemplateDetails> {
    let maybe_template = WorkoutTemplate::find_by_id(workout_template_id.clone())
        .one(db)
        .await?;
    let Some(details) = maybe_template else {
        bail!("Workout template with the given ID could not be found.");
    };
    let collections = entity_in_collections_with_details(
        db,
        user_id,
        &workout_template_id,
        EntityLot::WorkoutTemplate,
    )
    .await?;
    Ok(UserWorkoutTemplateDetails {
        details,
        collections,
    })
}

pub fn apply_collection_filter<C, D, E>(
    id_column: C,
    query: Select<D>,
    entity_column: E,
    collection_filters: Vec<MediaCollectionFilter>,
) -> Select<D>
where
    C: ColumnTrait,
    D: EntityTrait,
    E: ColumnTrait,
{
    if collection_filters.is_empty() {
        return query;
    }
    let is_in = collection_filters
        .iter()
        .filter(|f| f.presence == MediaCollectionPresenceFilter::PresentIn)
        .map(|f| f.collection_id.clone())
        .collect_vec();
    let is_not_in = collection_filters
        .iter()
        .filter(|f| f.presence == MediaCollectionPresenceFilter::NotPresentIn)
        .map(|f| f.collection_id.clone())
        .collect_vec();

    if is_in.is_empty() && !is_not_in.is_empty() {
        let items_in_collections = CollectionToEntity::find()
            .select_only()
            .column(entity_column)
            .filter(entity_column.is_not_null())
            .filter(
                Expr::col((
                    AliasedCollectionToEntity::Table,
                    collection_to_entity::Column::CollectionId,
                ))
                .is_in(is_not_in),
            );
        return query.filter(id_column.not_in_subquery(items_in_collections.into_query()));
    }
    let subquery = CollectionToEntity::find()
        .select_only()
        .column(entity_column)
        .filter(entity_column.is_not_null())
        .filter(
            Expr::col((
                AliasedCollectionToEntity::Table,
                collection_to_entity::Column::CollectionId,
            ))
            .is_in(is_in),
        );

    let subquery = match is_not_in.is_empty() {
        true => subquery,
        false => subquery.filter(
            Expr::col((
                AliasedCollectionToEntity::Table,
                collection_to_entity::Column::CollectionId,
            ))
            .is_not_in(is_not_in),
        ),
    };

    query.filter(id_column.in_subquery(subquery.into_query()))
}

/// If the token has an access link, then checks that:
/// - the access link is not revoked
/// - if the operation is a mutation, then the access link allows mutations
///
/// If any of the above conditions are not met, then an error is returned.
#[inline]
pub async fn check_token(
    session_id: &str,
    is_mutation: bool,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    let Some(session) = session_service::validate_session(ss, session_id).await? else {
        bail!(BackendError::SessionExpired.to_string());
    };
    let Some(access_link_id) = session.access_link_id else {
        return Ok(true);
    };
    let access_link = AccessLink::find_by_id(access_link_id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| anyhow!(BackendError::SessionExpired.to_string()))?;
    if access_link.is_revoked.unwrap_or_default() {
        bail!(BackendError::SessionExpired.to_string());
    }
    if is_mutation {
        if !access_link.is_mutation_allowed.unwrap_or_default() {
            bail!(BackendError::MutationNotAllowed.to_string());
        }
        return Ok(true);
    }
    Ok(true)
}

#[inline]
pub async fn deploy_job_to_mark_user_last_activity(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    ss.perform_application_job(ApplicationJob::Lp(
        LpApplicationJob::UpdateUserLastActivityPerformed(user_id.to_owned(), Utc::now()),
    ))
    .await?;
    Ok(())
}

pub async fn item_reviews(
    user_id: &String,
    entity_id: &String,
    entity_lot: EntityLot,
    // DEV: Setting this to true will return ALL user's reviews + public reviews by others
    get_public: bool,
    ss: &Arc<SupportingService>,
) -> Result<Vec<ReviewItem>> {
    let column = match entity_lot {
        EntityLot::Person => review::Column::PersonId,
        EntityLot::Exercise => review::Column::ExerciseId,
        EntityLot::Metadata => review::Column::MetadataId,
        EntityLot::Collection => review::Column::CollectionId,
        EntityLot::MetadataGroup => review::Column::MetadataGroupId,
        EntityLot::Genre
        | EntityLot::Review
        | EntityLot::Workout
        | EntityLot::WorkoutTemplate
        | EntityLot::UserMeasurement => unreachable!(),
    };
    let all_reviews = Review::find()
        .filter(match get_public {
            false => review::Column::UserId.eq(user_id),
            true => review::Column::UserId
                .eq(user_id)
                .or(review::Column::Visibility.eq(Visibility::Public)),
        })
        .find_also_related(User)
        .order_by_desc(review::Column::PostedOn)
        .filter(column.eq(entity_id))
        .all(&ss.db)
        .await?;
    let mut reviews = vec![];
    let preferences = user_by_id(user_id, ss).await?.preferences;
    for (review, user) in all_reviews {
        let user = user.unwrap();
        let rating = match true {
            true => review.rating.map(|s| {
                s.checked_div(match preferences.general.review_scale {
                    UserReviewScale::OutOfTen => dec!(10),
                    UserReviewScale::OutOfFive => dec!(20),
                    UserReviewScale::OutOfHundred | UserReviewScale::ThreePointSmiley => {
                        dec!(1)
                    }
                })
                .unwrap()
                .round_dp(1)
            }),
            false => review.rating,
        };
        let seen_items_associated_with = Seen::find()
            .select_only()
            .column(seen::Column::Id)
            .filter(seen::Column::ReviewId.eq(&review.id))
            .into_tuple::<String>()
            .all(&ss.db)
            .await?;
        let to_push = ReviewItem {
            rating,
            id: review.id,
            seen_items_associated_with,
            posted_on: review.posted_on,
            is_spoiler: review.is_spoiler,
            visibility: review.visibility,
            text_original: review.text.clone(),
            text_rendered: review.text.map(|t| markdown_to_html(&t)),
            show_extra_information: review.show_extra_information,
            podcast_extra_information: review.podcast_extra_information,
            anime_extra_information: review.anime_extra_information,
            manga_extra_information: review.manga_extra_information,
            posted_by: StringIdAndNamedObject {
                id: user.id,
                name: user.name,
            },
            comments: review.comments,
        };
        reviews.push(to_push);
    }
    let all_reviews = reviews
        .into_iter()
        .filter(|r| match r.visibility {
            Visibility::Private => &r.posted_by.id == user_id,
            _ => true,
        })
        .collect();
    Ok(all_reviews)
}

pub async fn deploy_job_to_calculate_user_activities_and_summary(
    user_id: &String,
    calculate_from_beginning: bool,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    ss.perform_application_job(ApplicationJob::Hp(
        HpApplicationJob::RecalculateUserActivitiesAndSummary(
            user_id.to_owned(),
            calculate_from_beginning,
        ),
    ))
    .await?;
    Ok(())
}

pub async fn schedule_user_for_workout_revision(
    user_id: &String,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    let user = User::find_by_id(user_id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| anyhow!("User with the given ID does not exist"))?;
    let mut extra_information = user.extra_information.clone().unwrap_or_default();
    extra_information.scheduled_for_workout_revision = true;
    let mut user = user.into_active_model();
    user.extra_information = ActiveValue::Set(Some(extra_information));
    user.update(&ss.db).await?;
    ryot_log!(debug, "Scheduled user for workout revision: {:?}", user_id);
    Ok(())
}

pub fn get_enabled_users_query() -> Select<User> {
    User::find().filter(
        user::Column::IsDisabled
            .eq(false)
            .or(user::Column::IsDisabled.is_null()),
    )
}

pub async fn transform_entity_assets(
    assets: &mut EntityAssets,
    ss: &Arc<SupportingService>,
) -> Result<()> {
    for image in assets.s3_images.iter_mut() {
        *image = file_storage_service::get_presigned_url(ss, image.clone()).await?;
    }
    for video in assets.s3_videos.iter_mut() {
        *video = file_storage_service::get_presigned_url(ss, video.clone()).await?;
    }
    Ok(())
}
