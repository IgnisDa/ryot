use anyhow::{Result, anyhow};
use database_models::{prelude::UserMeasurement, user_measurement};
use dependent_models::{CachedResponse, UserMeasurementsListResponse};
use dependent_utils::{
    create_user_measurement as create_user_measurement_util, expire_user_measurements_list_cache,
    user_measurements_list as get_user_measurements_list,
};
use fitness_models::UserMeasurementsListInput;
use sea_orm::{EntityTrait, ModelTrait, prelude::DateTimeUtc};
use std::sync::Arc;
use supporting_service::SupportingService;

pub async fn user_measurements_list(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: UserMeasurementsListInput,
) -> Result<CachedResponse<UserMeasurementsListResponse>> {
    get_user_measurements_list(user_id, ss, input).await
}

pub async fn create_user_measurement(
    ss: &Arc<SupportingService>,
    user_id: &String,
    input: user_measurement::Model,
) -> Result<DateTimeUtc> {
    create_user_measurement_util(user_id, input, ss).await
}

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
