use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use background_models::{ApplicationJob, HpApplicationJob};
use common_models::StringIdObject;
use common_utils::ryot_log;
use database_models::{
    prelude::{Collection, Exercise, Genre, Review, Workout, WorkoutTemplate},
    review,
};
use database_utils::user_by_id;
use dependent_details_utils::{metadata_details, metadata_group_details, person_details};
use dependent_utility_utils::associate_user_with_entity;
use enum_models::{EntityLot, Visibility};
use media_models::{
    CreateOrUpdateReviewInput, ImportOrExportItemRating, ReviewPostedEvent,
    SeenAnimeExtraInformation, SeenMangaExtraInformation, SeenPodcastExtraOptionalInformation,
    SeenShowExtraOptionalInformation,
};
use rust_decimal::dec;
use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait, IntoActiveModel};
use supporting_service::SupportingService;
use user_models::{UserPreferences, UserReviewScale};

pub async fn create_or_update_review(
    user_id: &String,
    input: CreateOrUpdateReviewInput,
    ss: &Arc<SupportingService>,
) -> Result<StringIdObject> {
    let is_update = input.review_id.is_some();
    let existing_review = match input.review_id.as_ref() {
        Some(review_id) => {
            let existing = Review::find_by_id(review_id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!("Review not found"))?;
            if existing.user_id != *user_id {
                bail!("This review does not belong to you");
            }
            if existing.entity_id != input.entity_id || existing.entity_lot != input.entity_lot {
                bail!("Review entity does not match the existing review");
            }
            Some(existing)
        }
        None => None,
    };
    let preferences = user_by_id(user_id, ss).await?.preferences;
    if preferences.general.disable_reviews {
        bail!("Reviews are disabled");
    }
    let show_ei = match (input.show_season_number, input.show_episode_number) {
        (None, None) => None,
        (season, episode) => Some(SeenShowExtraOptionalInformation { season, episode }),
    };
    let podcast_ei =
        input
            .podcast_episode_number
            .map(|episode| SeenPodcastExtraOptionalInformation {
                episode: Some(episode),
            });
    let anime_ei = input
        .anime_episode_number
        .map(|episode| SeenAnimeExtraInformation {
            episode: Some(episode),
        });
    let manga_ei = match (input.manga_chapter_number, input.manga_volume_number) {
        (None, None) => None,
        (chapter, volume) => Some(SeenMangaExtraInformation { chapter, volume }),
    };

    if input.rating.is_none() && input.text.is_none() {
        bail!("At-least one of rating or review is required.");
    }
    let mut review_obj = match existing_review {
        Some(existing) => existing.into_active_model(),
        None => review::ActiveModel {
            comments: ActiveValue::Set(vec![]),
            user_id: ActiveValue::Set(user_id.to_owned()),
            ..Default::default()
        },
    };
    review_obj.text = ActiveValue::Set(input.text);
    review_obj.show_extra_information = ActiveValue::Set(show_ei);
    review_obj.anime_extra_information = ActiveValue::Set(anime_ei);
    review_obj.manga_extra_information = ActiveValue::Set(manga_ei);
    review_obj.podcast_extra_information = ActiveValue::Set(podcast_ei);
    review_obj.rating = ActiveValue::Set(input.rating.map(
        |r| match preferences.general.review_scale {
            UserReviewScale::OutOfTen => r * dec!(10),
            UserReviewScale::OutOfFive => r * dec!(20),
            UserReviewScale::OutOfHundred | UserReviewScale::ThreePointSmiley => r,
        },
    ));
    macro_rules! set_review_id {
        ($field:ident) => {
            if !is_update {
                review_obj.$field = ActiveValue::Set(Some(input.entity_id.clone()))
            }
        };
    }
    match input.entity_lot {
        EntityLot::Person => set_review_id!(person_id),
        EntityLot::Metadata => set_review_id!(metadata_id),
        EntityLot::Exercise => set_review_id!(exercise_id),
        EntityLot::Collection => set_review_id!(collection_id),
        EntityLot::MetadataGroup => set_review_id!(metadata_group_id),
        EntityLot::Genre
        | EntityLot::Review
        | EntityLot::Workout
        | EntityLot::WorkoutTemplate
        | EntityLot::UserMeasurement => {
            bail!(
                "Reviews are not supported for entity lot: {:?}",
                input.entity_lot
            );
        }
    };
    if let Some(s) = input.is_spoiler {
        review_obj.is_spoiler = ActiveValue::Set(s);
    }
    if let Some(v) = input.visibility {
        review_obj.visibility = ActiveValue::Set(v);
    }
    if let Some(d) = input.date {
        review_obj.posted_on = ActiveValue::Set(d);
    }
    let insert = review_obj.save(&ss.db).await?;
    if insert.visibility.unwrap() == Visibility::Public {
        let entity_lot = insert.entity_lot.unwrap();
        let id = insert.entity_id.unwrap();
        let obj_title = get_entity_title_from_id_and_lot(&id, entity_lot, ss).await?;
        let user = user_by_id(&insert.user_id.unwrap(), ss).await?;
        // DEV: Do not send notification if updating a review
        if input.review_id.is_none() {
            ss.perform_application_job(ApplicationJob::Hp(HpApplicationJob::ReviewPosted(
                ReviewPostedEvent {
                    obj_title,
                    entity_lot,
                    obj_id: id,
                    username: user.name,
                    review_id: insert.id.clone().unwrap(),
                },
            )))
            .await?;
        }
    }
    associate_user_with_entity(user_id, &input.entity_id, input.entity_lot, ss).await?;
    Ok(StringIdObject {
        id: insert.id.unwrap(),
    })
}

pub fn convert_review_into_input(
    review: &ImportOrExportItemRating,
    preferences: &UserPreferences,
    entity_id: String,
    entity_lot: EntityLot,
) -> Option<CreateOrUpdateReviewInput> {
    if review.review.is_none() && review.rating.is_none() {
        ryot_log!(debug, "Skipping review since it has no content");
        return None;
    }
    let rating = match preferences.general.review_scale {
        UserReviewScale::OutOfTen => review.rating.map(|rating| rating / dec!(10)),
        UserReviewScale::OutOfFive => review.rating.map(|rating| rating / dec!(20)),
        UserReviewScale::OutOfHundred | UserReviewScale::ThreePointSmiley => review.rating,
    };
    let text = review.review.clone().and_then(|r| r.text);
    let is_spoiler = review.review.clone().map(|r| r.spoiler.unwrap_or(false));
    let date = review.review.clone().map(|r| r.date);
    Some(CreateOrUpdateReviewInput {
        text,
        rating,
        entity_id,
        entity_lot,
        is_spoiler,
        date: date.flatten(),
        show_season_number: review.show_season_number,
        show_episode_number: review.show_episode_number,
        manga_chapter_number: review.manga_chapter_number,
        podcast_episode_number: review.podcast_episode_number,
        visibility: review.review.clone().and_then(|r| r.visibility),
        ..Default::default()
    })
}

async fn get_entity_title_from_id_and_lot(
    id: &String,
    lot: EntityLot,
    ss: &Arc<SupportingService>,
) -> Result<String> {
    let obj_title = match lot {
        EntityLot::Genre => {
            Genre::find_by_id(id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!("Genre not found"))?
                .name
        }
        EntityLot::Metadata => metadata_details(ss, id).await?.response.title,
        EntityLot::MetadataGroup => metadata_group_details(ss, id).await?.response.details.title,
        EntityLot::Person => person_details(id, ss).await?.response.details.name,
        EntityLot::Collection => {
            Collection::find_by_id(id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!("Collection not found"))?
                .name
        }
        EntityLot::Exercise => {
            Exercise::find_by_id(id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!("Exercise not found"))?
                .name
        }
        EntityLot::Workout => {
            Workout::find_by_id(id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!("Workout not found"))?
                .name
        }
        EntityLot::WorkoutTemplate => {
            WorkoutTemplate::find_by_id(id)
                .one(&ss.db)
                .await?
                .ok_or_else(|| anyhow!("Workout template not found"))?
                .name
        }
        EntityLot::Review | EntityLot::UserMeasurement => {
            bail!("Reviews are not supported for entity lot: {lot:?}");
        }
    };
    Ok(obj_title)
}
