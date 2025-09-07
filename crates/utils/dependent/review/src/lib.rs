use std::sync::Arc;

use anyhow::{Result, bail};
use background_models::{ApplicationJob, HpApplicationJob};
use common_models::StringIdObject;
use common_utils::ryot_log;
use database_models::review;
use database_utils::user_by_id;
use dependent_utility_utils::{associate_user_with_entity, get_entity_title_from_id_and_lot};
use enum_models::{EntityLot, Visibility};
use media_models::{
    CreateOrUpdateReviewInput, ImportOrExportItemRating, ReviewPostedEvent,
    SeenAnimeExtraInformation, SeenMangaExtraInformation, SeenPodcastExtraOptionalInformation,
    SeenShowExtraOptionalInformation,
};
use rust_decimal_macros::dec;
use sea_orm::{ActiveModelTrait, ActiveValue};
use supporting_service::SupportingService;
use user_models::{UserPreferences, UserReviewScale};

pub async fn post_review(
    user_id: &String,
    input: CreateOrUpdateReviewInput,
    ss: &Arc<SupportingService>,
) -> Result<StringIdObject> {
    let preferences = user_by_id(user_id, ss).await?.preferences;
    if preferences.general.disable_reviews {
        bail!("Reviews are disabled");
    }
    let show_ei = if input.show_season_number.is_some() || input.show_episode_number.is_some() {
        Some(SeenShowExtraOptionalInformation {
            season: input.show_season_number,
            episode: input.show_episode_number,
        })
    } else {
        None
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
    let manga_ei = if input.manga_chapter_number.is_none() && input.manga_volume_number.is_none() {
        None
    } else {
        Some(SeenMangaExtraInformation {
            chapter: input.manga_chapter_number,
            volume: input.manga_volume_number,
        })
    };

    if input.rating.is_none() && input.text.is_none() {
        bail!("At-least one of rating or review is required.");
    }
    let mut review_obj =
        review::ActiveModel {
            text: ActiveValue::Set(input.text),
            comments: ActiveValue::Set(vec![]),
            user_id: ActiveValue::Set(user_id.to_owned()),
            show_extra_information: ActiveValue::Set(show_ei),
            anime_extra_information: ActiveValue::Set(anime_ei),
            manga_extra_information: ActiveValue::Set(manga_ei),
            podcast_extra_information: ActiveValue::Set(podcast_ei),
            id: match input.review_id.clone() {
                Some(i) => ActiveValue::Unchanged(i),
                None => ActiveValue::NotSet,
            },
            rating: ActiveValue::Set(input.rating.map(
                |r| match preferences.general.review_scale {
                    UserReviewScale::OutOfTen => r * dec!(10),
                    UserReviewScale::OutOfFive => r * dec!(20),
                    UserReviewScale::OutOfHundred | UserReviewScale::ThreePointSmiley => r,
                },
            )),
            ..Default::default()
        };
    let entity_id = input.entity_id.clone();
    match input.entity_lot {
        EntityLot::Metadata => review_obj.metadata_id = ActiveValue::Set(Some(entity_id)),
        EntityLot::Person => review_obj.person_id = ActiveValue::Set(Some(entity_id)),
        EntityLot::MetadataGroup => {
            review_obj.metadata_group_id = ActiveValue::Set(Some(entity_id))
        }
        EntityLot::Collection => review_obj.collection_id = ActiveValue::Set(Some(entity_id)),
        EntityLot::Exercise => review_obj.exercise_id = ActiveValue::Set(Some(entity_id)),
        EntityLot::Genre
        | EntityLot::Review
        | EntityLot::Workout
        | EntityLot::WorkoutTemplate
        | EntityLot::UserMeasurement => unreachable!(),
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
    let insert = review_obj.save(&ss.db).await.unwrap();
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
