use serde_json::Value;

use crate::{ProtocolEvaluateRequest, ProtocolEvaluateResponse};

#[derive(Debug, Clone)]
pub struct ProtocolPluginManifest {
    pub id: &'static str,
    pub display_name: &'static str,
    pub version: &'static str,
}

pub trait ProtocolPlugin: Send + Sync {
    fn id(&self) -> &'static str;

    fn display_name(&self) -> &'static str;

    fn version(&self) -> &'static str {
        "1.0.0"
    }

    fn manifest(&self) -> ProtocolPluginManifest {
        ProtocolPluginManifest {
            id: self.id(),
            display_name: self.display_name(),
            version: self.version(),
        }
    }

    fn default_policy(&self) -> Value;

    fn empty_stats(&self) -> Value;

    fn validate(&self, input: &ProtocolEvaluateRequest) -> Result<(), String>;

    fn evaluate(&self, input: &ProtocolEvaluateRequest) -> Result<ProtocolEvaluateResponse, String>;
}
