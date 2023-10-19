mod length_vec;

pub use length_vec::LengthVec;

pub const PROJECT_NAME: &str = "ryot";

/// Determine whether a feature is enabled
pub trait IsFeatureEnabled {
    fn is_enabled(&self) -> bool {
        true
    }
}
