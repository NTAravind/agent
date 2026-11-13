/** Typed errors raised by the provider layer. */

export type ModelLayerErrorCode =
  | "unknown_model"
  | "provider_not_configured"
  | "capability_mismatch"
  | "private_context_not_allowed"
  | "all_models_failed";

export class ModelLayerError extends Error {
  constructor(
    readonly code: ModelLayerErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ModelLayerError";
  }
}

export class ModelRegistryError extends ModelLayerError {
  constructor(code: ModelLayerErrorCode, message: string, details?: Record<string, unknown>) {
    super(code, message, details);
    this.name = "ModelRegistryError";
  }
}

export class CapabilityError extends ModelLayerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("capability_mismatch", message, details);
    this.name = "CapabilityError";
  }
}
