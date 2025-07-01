use std::sync::Arc;

use async_graphql::{Error, Result};
use background_models::{ApplicationJob, HpApplicationJob, LpApplicationJob};
use chrono::Utc;
use common_models::{BackendError, EntityAssets, IdAndNamedObject};
use common_utils::ryot_log;
use database_models::{
    access_link, collection, collection_to_entity,
    prelude::{
        AccessLink, Collection, CollectionToEntity, Review, Seen, User, UserToEntity, Workout,
        WorkoutTemplate,
    },
    review, seen, user, user_to_entity, workout,
};
use dependent_models::{
    CollectionToEntityDetails, GraphqlCollectionToEntityDetails, UserWorkoutDetails,
    UserWorkoutTemplateDetails,
};
use enum_models::{EntityLot, UserLot, Visibility};

use itertools::Itertools;
use jwt_service::{Claims, verify};
use markdown::to_html as markdown_to_html;
use media_models::{MediaCollectionFilter, MediaCollectionPresenceFilter, ReviewItem};
use migrations::AliasedCollectionToEntity;
use rust_decimal_macros::dec;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, QuerySelect, QueryTrait, Select, prelude::Expr, sea_query::PgFunc,
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
        .ok_or_else(|| Error::new("No user found"))?;
    Ok(user)
}

pub async fn admin_account_guard(user_id: &String, ss: &Arc<SupportingService>) -> Result<()> {
    let main_user = user_by_id(user_id, ss).await?;
    if main_user.lot != UserLot::Admin {
        return Err(Error::new(BackendError::AdminOnlyAction.to_string()));
    }
    Ok(())
}

pub async fn server_key_validation_guard(is_server_key_validated: bool) -> Result<()> {
    if !is_server_key_validated {
        return Err(Error::new(
            "This feature is only available on the Pro version",
        ));
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
    let user_collections = Collection::find()
        .left_join(UserToEntity)
        .filter(user_to_entity::Column::UserId.eq(user_id))
        .all(db)
        .await
        .unwrap();
    let mtc = CollectionToEntity::find()
        .filter(
            collection_to_entity::Column::CollectionId
                .is_in(user_collections.into_iter().map(|c| c.id).collect_vec()),
        )
        .filter(collection_to_entity::Column::EntityId.eq(entity_id))
        .filter(collection_to_entity::Column::EntityLot.eq(entity_lot))
        .find_also_related(Collection)
        .all(db)
        .await
        .unwrap();
    let resp = mtc
        .into_iter()
        .map(|(cte, col)| GraphqlCollectionToEntityDetails {
            id: cte.id,
            details: CollectionToEntityDetails {
                collection_id: col.as_ref().unwrap().id.clone(),
                collection_name: col.as_ref().unwrap().name.clone(),
                created_on: cte.created_on,
                information: cte.information,
                last_updated_on: cte.last_updated_on,
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
        return Err(Error::new(
            "Workout with the given ID could not be found for this user.",
        ));
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
        return Err(Error::new(
            "Workout template with the given ID could not be found.",
        ));
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

pub fn user_claims_from_token(token: &str, jwt_secret: &str) -> Result<Claims> {
    verify(token, jwt_secret).map_err(|e| Error::new(format!("Encountered error: {:?}", e)))
}

/// If the token has an access link, then checks that:
/// - the access link is not revoked
/// - if the operation is a mutation, then the access link allows mutations
///
/// If any of the above conditions are not met, then an error is returned.
#[inline]
pub async fn check_token(
    token: &str,
    is_mutation: bool,
    ss: &Arc<SupportingService>,
) -> Result<bool> {
    let claims = user_claims_from_token(token, &ss.config.users.jwt_secret)?;
    let Some(access_link_id) = claims.access_link_id else {
        return Ok(true);
    };
    let access_link = AccessLink::find_by_id(access_link_id)
        .one(&ss.db)
        .await?
        .ok_or_else(|| Error::new(BackendError::SessionExpired.to_string()))?;
    if access_link.is_revoked.unwrap_or_default() {
        return Err(Error::new(BackendError::SessionExpired.to_string()));
    }
    if is_mutation {
        if !access_link.is_mutation_allowed.unwrap_or_default() {
            return Err(Error::new(BackendError::MutationNotAllowed.to_string()));
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
        EntityLot::Metadata => review::Column::MetadataId,
        EntityLot::MetadataGroup => review::Column::MetadataGroupId,
        EntityLot::Person => review::Column::PersonId,
        EntityLot::Exercise => review::Column::ExerciseId,
        EntityLot::Collection => review::Column::CollectionId,
        EntityLot::Workout
        | EntityLot::WorkoutTemplate
        | EntityLot::Review
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
        .await
        .unwrap();
    let mut reviews = vec![];
    for (review, user) in all_reviews {
        let user = user.unwrap();
        let rating = match true {
            true => {
                let preferences = user_by_id(user_id, ss).await?.preferences;
                review.rating.map(|s| {
                    s.checked_div(match preferences.general.review_scale {
                        UserReviewScale::OutOfTen => dec!(10),
                        UserReviewScale::OutOfFive => dec!(20),
                        UserReviewScale::OutOfHundred | UserReviewScale::ThreePointSmiley => {
                            dec!(1)
                        }
                    })
                    .unwrap()
                    .round_dp(1)
                })
            }
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
            posted_by: IdAndNamedObject {
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
        .ok_or_else(|| Error::new("User with the given ID does not exist"))?;
    let mut extra_information = user.extra_information.clone().unwrap_or_default();
    extra_information.scheduled_for_workout_revision = true;
    let mut user: user::ActiveModel = user.into();
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
        *image = ss
            .file_storage_service
            .get_presigned_url(image.clone())
            .await?;
    }
    for video in assets.s3_videos.iter_mut() {
        *video = ss
            .file_storage_service
            .get_presigned_url(video.clone())
            .await?;
    }
    Ok(())
}
