use std::sync::Arc;

use anyhow::{Result, anyhow};
use database_models::prelude::UserMeasurement;
use dependent_utility_utils::expire_user_measurements_list_cache;
use sea_orm::{EntityTrait, ModelTrait, prelude::DateTimeUtc};
use supporting_service::SupportingService;

pub async fn delete_user_measurement(
    ss: &Arc<SupportingService>,
    user_id: &String,
    timestamp: DateTimeUtc,
) -> Result<bool> {
    let m = UserMeasurement::find_by_id((user_id.to_owned(), timestamp))
        .one(&ss.db)
        .await?
        .ok_or(anyhow!("Measurement does not exist"))?;
    m.delete(&ss.db).await?;
    expire_user_measurements_list_cache(user_id, ss).await?;
    Ok(true)
}
