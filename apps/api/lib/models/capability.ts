import type { ModelCapability, ModelRegistryEntry, RequiredCapabilities } from "@agent/shared";
import { MODEL_CAPABILITIES } from "@agent/shared";

import { CapabilityError } from "./errors";

/**
 * Capability gate. A request states what it needs; a model states what it can do.
 * The gate runs before any provider call so an unsupported request fails loudly
 * instead of silently degrading.
 */
export function missingCapabilities(
  entry: ModelRegistryEntry,
  required: RequiredCapabilities = {},
): ModelCapability[] {
  return MODEL_CAPABILITIES.filter((capability) => {
    if (required[capability] !== true) return false;
    return entry.capabilities[capability] !== true;
  });
}

export function supportsCapabilities(
  entry: ModelRegistryEntry,
  required: RequiredCapabilities = {},
): boolean {
  return missingCapabilities(entry, required).length === 0;
}

/** Throws a CapabilityError when the model cannot satisfy the request. */
export function assertCapabilities(
  entry: ModelRegistryEntry,
  required: RequiredCapabilities = {},
): void {
  const missing = missingCapabilities(entry, required);
  if (missing.length > 0) {
    throw new CapabilityError(
      `Model ${entry.id} does not support: ${missing.join(", ")}`,
      { modelId: entry.id, missing },
    );
  }
}

/** Keeps only the models that can serve the request. */
export function filterByCapabilities(
  entries: ModelRegistryEntry[],
  required: RequiredCapabilities = {},
): ModelRegistryEntry[] {
  return entries.filter((entry) => supportsCapabilities(entry, required));
}
