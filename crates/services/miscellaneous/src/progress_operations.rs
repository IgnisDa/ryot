use std::sync::Arc;

use async_graphql::{Error, Result};
use common_models::StringIdObject;
use database_models::{
    prelude::{Review, Seen},
    seen,
};
use dependent_utils::{
    associate_user_with_entity, handle_after_metadata_seen_tasks, metadata_progress_update,
    progress_update,
};
use enum_models::EntityLot;
use media_models::{MetadataProgressUpdateInput, ProgressUpdateInput, UpdateSeenItemInput};
use sea_orm::{ActiveModelTrait, ActiveValue, EntityTrait, ModelTrait};
use supporting_service::SupportingService;
use traits::TraceOk;

pub async fn update_seen_item(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: UpdateSeenItemInput,
) -> Result<bool> {
    let Some(seen) = Seen::find_by_id(input.seen_id).one(&ss.db).await? else {
        return Err(Error::new("No seen found for this user and metadata"));
    };
    if &seen.user_id != user_id {
        return Err(Error::new("No seen found for this user and metadata"));
    }
    let mut seen: seen::ActiveModel = seen.into();
    if let Some(started_on) = input.started_on {
        seen.started_on = ActiveValue::Set(Some(started_on));
    }
    if let Some(finished_on) = input.finished_on {
        seen.finished_on = ActiveValue::Set(Some(finished_on));
    }
    if let Some(provider_watched_on) = input.provider_watched_on {
        seen.provider_watched_on = ActiveValue::Set(Some(provider_watched_on));
    }
    if let Some(manual_time_spent) = input.manual_time_spent {
        seen.manual_time_spent = ActiveValue::Set(Some(manual_time_spent));
    }
    if let Some(review_id) = input.review_id {
        let (review, to_update_review_id) = match review_id.is_empty() {
            false => (
                Review::find_by_id(&review_id).one(&ss.db).await?,
                Some(review_id),
            ),
            true => (None, None),
        };
        if let Some(review_item) = review {
            if &review_item.user_id != user_id {
                return Err(Error::new(
                    "You cannot associate a review with a seen item that is not yours",
                ));
            }
        }
        seen.review_id = ActiveValue::Set(to_update_review_id);
    }
    let seen = seen.update(&ss.db).await?;
    handle_after_metadata_seen_tasks(seen, ss).await?;
    Ok(true)
}

pub async fn delete_seen_item(
    ss: &Arc<SupportingService>,
    user_id: &String,
    seen_id: String,
) -> Result<StringIdObject> {
    let seen_item = Seen::find_by_id(seen_id).one(&ss.db).await?;
    let Some(si) = seen_item else {
        return Err(Error::new("This seen item does not exist".to_owned()));
    };
    let cloned_seen = si.clone();
    if &si.user_id != user_id {
        return Err(Error::new(
            "This seen item does not belong to this user".to_owned(),
        ));
    }
    let seen_id = si.id.clone();
    let metadata_id = si.metadata_id.clone();
    si.delete(&ss.db).await.trace_ok();
    handle_after_metadata_seen_tasks(cloned_seen, ss).await?;
    associate_user_with_entity(user_id, &metadata_id, EntityLot::Metadata, ss).await?;
    Ok(StringIdObject { id: seen_id })
}

pub async fn bulk_progress_update(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: Vec<ProgressUpdateInput>,
) -> Result<()> {
    for seen in input {
        progress_update(user_id, false, seen, ss).await.trace_ok();
    }
    Ok(())
}

pub async fn bulk_metadata_progress_update(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: Vec<MetadataProgressUpdateInput>,
) -> Result<()> {
    for seen in input {
        metadata_progress_update(user_id, ss, seen).await.trace_ok();
    }
    Ok(())
}
