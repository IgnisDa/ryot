use std::sync::Arc;

use anyhow::Result;
use database_models::{exercise, metadata, metadata_group};
use dependent_fitness_utils::{create_custom_exercise, update_custom_exercise};
use dependent_models::UpdateCustomExerciseInput;
use media_models::{
    CreateCustomMetadataGroupInput, CreateCustomMetadataInput, UpdateCustomMetadataInput,
};
use supporting_service::SupportingService;

pub struct CustomService(pub Arc<SupportingService>);

impl CustomService {
    /// Create a custom exercise for the user.
    pub async fn create_custom_exercise(
        &self,
        user_id: &String,
        input: exercise::Model,
    ) -> Result<String> {
        create_custom_exercise(user_id, input, &self.0).await
    }

    /// Update a custom exercise.
    pub async fn update_custom_exercise(
        &self,
        user_id: String,
        input: UpdateCustomExerciseInput,
    ) -> Result<bool> {
        update_custom_exercise(&self.0, user_id, input).await
    }

    /// Create custom metadata.
    pub async fn create_custom_metadata(
        &self,
        user_id: String,
        input: CreateCustomMetadataInput,
    ) -> Result<metadata::Model> {
        miscellaneous_metadata_operations_service::create_custom_metadata(&self.0, user_id, input)
            .await
    }

    /// Update custom metadata.
    pub async fn update_custom_metadata(
        &self,
        user_id: &String,
        input: UpdateCustomMetadataInput,
    ) -> Result<bool> {
        miscellaneous_metadata_operations_service::update_custom_metadata(&self.0, user_id, input)
            .await
    }

    /// Create a custom metadata group.
    pub async fn create_custom_metadata_group(
        &self,
        user_id: &String,
        input: CreateCustomMetadataGroupInput,
    ) -> Result<metadata_group::Model> {
        miscellaneous_metadata_operations_service::create_custom_metadata_group(
            &self.0, user_id, input,
        )
        .await
    }
}
