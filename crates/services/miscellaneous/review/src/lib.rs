use std::{collections::HashSet, sync::Arc};

use anyhow::{Result, anyhow, bail};
use chrono::Utc;
use common_models::StringIdAndNamedObject;
use database_models::{prelude::Review, review};
use database_utils::user_by_id;
use dependent_utility_utils::associate_user_with_entity;
use enum_models::Visibility;
use media_models::{CreateReviewCommentInput, ImportOrExportItemReviewComment};
use nanoid::nanoid;
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, EntityTrait, IntoActiveModel, ModelTrait,
    QueryFilter, QuerySelect, TransactionTrait,
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
                associate_user_with_entity(&user_id, &r.entity_id, r.entity_lot, ss).await?;
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
    let txn = ss.db.begin().await?;
    let Some(review) = Review::find_by_id(input.review_id)
        .lock_exclusive()
        .one(&txn)
        .await?
    else {
        bail!("Review not found");
    };
    if review.user_id != user_id && review.visibility != Visibility::Public {
        bail!("You cannot interact with this review");
    }

    let should_delete = input.should_delete.unwrap_or_default();
    let increment_likes = input.increment_likes.unwrap_or_default();
    let decrement_likes = input.decrement_likes.unwrap_or_default();
    if [should_delete, increment_likes, decrement_likes]
        .into_iter()
        .filter(|action| *action)
        .count()
        > 1
    {
        bail!("Only one comment action can be requested at a time");
    }

    let mut comments = review.comments.clone();
    if should_delete {
        let comment_id = input
            .comment_id
            .as_deref()
            .ok_or_else(|| anyhow!("Comment ID is required"))?;
        let position = comments
            .iter()
            .position(|comment| comment.id == comment_id)
            .ok_or_else(|| anyhow!("Comment not found"))?;
        if comments[position].user.id != user_id {
            bail!("Only the comment author can delete it");
        }
        comments.remove(position);
    } else if increment_likes {
        let comment_id = input
            .comment_id
            .as_deref()
            .ok_or_else(|| anyhow!("Comment ID is required"))?;
        let comment = comments
            .iter_mut()
            .find(|comment| comment.id == comment_id)
            .ok_or_else(|| anyhow!("Comment not found"))?;
        comment.liked_by.insert(user_id.clone());
    } else if decrement_likes {
        let comment_id = input
            .comment_id
            .as_deref()
            .ok_or_else(|| anyhow!("Comment ID is required"))?;
        let comment = comments
            .iter_mut()
            .find(|comment| comment.id == comment_id)
            .ok_or_else(|| anyhow!("Comment not found"))?;
        comment.liked_by.remove(&user_id);
    } else {
        let text = input
            .text
            .filter(|text| !text.is_empty())
            .ok_or_else(|| anyhow!("Comment text is required"))?;
        let user = user_by_id(&user_id, ss).await?;
        comments.push(ImportOrExportItemReviewComment {
            id: nanoid!(20),
            text,
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
    review.update(&txn).await?;
    txn.commit().await?;
    Ok(true)
}
