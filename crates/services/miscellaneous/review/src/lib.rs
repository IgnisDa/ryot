use std::{collections::HashSet, sync::Arc};

use anyhow::{Result, anyhow, bail};
use chrono::Utc;
use common_models::{EntityWithLot, StringIdAndNamedObject};
use database_models::{prelude::Review, review};
use database_utils::user_by_id;
use dependent_utility_utils::associate_user_with_entity;
use media_models::{CreateReviewCommentInput, ImportOrExportItemReviewComment};
use nanoid::nanoid;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, ModelTrait,
    QueryFilter,
};
use supporting_service::SupportingService;

pub async fn delete_review(
    ss: &Arc<SupportingService>,
    user_id: String,
    review_id: String,
) -> Result<bool> {
    let review = Review::find()
        .filter(review::Column::Id.eq(review_id))
        .one(&ss.db)
        .await?;
    match review {
        Some(r) => {
            if r.user_id == user_id {
                associate_user_with_entity(
                    &user_id,
                    EntityWithLot {
                        entity_lot: r.entity_lot,
                        entity_id: r.entity_id.clone(),
                    },
                    ss,
                )
                .await?;
                r.delete(&ss.db).await?;
                Ok(true)
            } else {
                Err(anyhow!("This review does not belong to you"))
            }
        }
        None => Ok(false),
    }
}

pub async fn create_review_comment(
    ss: &Arc<SupportingService>,
    user_id: String,
    input: CreateReviewCommentInput,
) -> Result<bool> {
    let Some(review) = Review::find_by_id(input.review_id).one(&ss.db).await? else {
        bail!("Review not found");
    };
    let mut comments = review.comments.clone();
    if input.should_delete.unwrap_or_default() {
        let position = comments
            .iter()
            .position(|r| &r.id == input.comment_id.as_ref().unwrap())
            .unwrap();
        comments.remove(position);
    } else if input.increment_likes.unwrap_or_default() {
        let comment = comments
            .iter_mut()
            .find(|r| &r.id == input.comment_id.as_ref().unwrap())
            .unwrap();
        comment.liked_by.insert(user_id.clone());
    } else if input.decrement_likes.unwrap_or_default() {
        let comment = comments
            .iter_mut()
            .find(|r| &r.id == input.comment_id.as_ref().unwrap())
            .unwrap();
        comment.liked_by.remove(&user_id);
    } else {
        let user = user_by_id(&user_id, ss).await?;
        comments.push(ImportOrExportItemReviewComment {
            id: nanoid!(20),
            text: input.text.unwrap(),
            user: StringIdAndNamedObject {
                id: user_id,
                name: user.name,
            },
            liked_by: HashSet::new(),
            created_on: Utc::now(),
        });
    }
    let mut review = review.into_active_model();
    review.comments = ActiveValue::Set(comments);
    review.update(&ss.db).await?;
    Ok(true)
}
