import type { LanguagePair } from "./types.js";

/** Separator for registry keys, e.g. "de-en". */
const PAIR_SEPARATOR = "-";

export function languagePairKey(pair: LanguagePair): string {
  return `${pair.from}${PAIR_SEPARATOR}${pair.to}`;
}

export function parseLanguagePairKey(key: string): LanguagePair {
  const idx = key.indexOf(PAIR_SEPARATOR);
  if (idx <= 0 || idx === key.length - 1) {
    throw new Error(`Invalid language pair key: ${key}`);
  }
  return { from: key.slice(0, idx), to: key.slice(idx + 1) };
}

/** A downloadable model file. */
export interface ModelFile {
  url: string;
  size?: number;
  sha256?: string;
}

/** Description of a model in the registry. */
export interface ModelDescriptor {
  /** Unique model ID, e.g. "tiny-de-en-v1". */
  id: string;
  version: string;
  /** Engine ID that can load this model. */
  engine: string;
  /** Engine-spezifische ID, z.B. "Xenova/opus-mt-de-en" für HF-Hub. */
  engineModelId?: string;
  files: ModelFile[];
  /** Optional engine-specific metadata. */
  metadata?: Record<string, unknown>;
}

/**
 * Provides model descriptors per language pair.
 * Implementations may be local (static) or remote (fetch).
 */
export interface ModelRegistry {
  getModel(pair: LanguagePair): Promise<ModelDescriptor | undefined>;
}

/**
 * Optional synchronous registry extension. Allows engines to answer supports()
 * synchronously without a race condition.
 */
export interface StaticModelRegistry extends ModelRegistry {
  getModelSync(pair: LanguagePair): ModelDescriptor | undefined;
}

export function isStaticRegistry(registry: ModelRegistry): registry is StaticModelRegistry {
  return typeof (registry as StaticModelRegistry).getModelSync === "function";
}

/** Creates a simple static registry from a record. */
export function createStaticRegistry(
  models: Record<string, ModelDescriptor>,
): StaticModelRegistry {
  const map = new Map<string, ModelDescriptor>();
  for (const [key, value] of Object.entries(models)) {
    map.set(key, value);
  }
  const get = (pair: LanguagePair): ModelDescriptor | undefined => map.get(languagePairKey(pair));
  return {
    getModel: (pair: LanguagePair) => Promise.resolve(get(pair)),
    getModelSync: get,
  };
}

/**
 * Helper that loads an asynchronous registry into a static registry.
 * Useful for engines whose supports() method is synchronous.
 */
export async function preloadRegistry(registry: ModelRegistry): Promise<StaticModelRegistry> {
  if (isStaticRegistry(registry)) {
    return registry;
  }
  const withEntries = registry as ModelRegistry & {
    entries?: () => Promise<Array<[LanguagePair, ModelDescriptor]>>;
  };
  if (typeof withEntries.entries !== "function") {
    throw new Error(
      "Registry is not static and provides no entries() method; cannot preload for synchronous supports()",
    );
  }
  const entries = await withEntries.entries();
  const models: Record<string, ModelDescriptor> = {};
  for (const [pair, descriptor] of entries) {
    models[languagePairKey(pair)] = descriptor;
  }
  return createStaticRegistry(models);
}

export type { LanguagePair };
