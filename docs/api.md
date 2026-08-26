# API Referenz

Dieses Dokument beschreibt die öffentliche API von **Lite Translator** — aufgeteilt in das Core-Package (`@lite-translator/core`) und das ONNX-Engine-Package (`@lite-translator/engine-onnx`).

---

## Inhaltsverzeichnis

- [Core (`@lite-translator/core`)](#core-lite-translatorcore)
  - [createTranslator](#createtranslator)
  - [Translator](#translator)
  - [TranslationEngine (Interface)](#translationengine-interface)
  - [Engine-Registrierung](#engine-registrierung)
  - [TranslationStore](#translationstore)
  - [TranslatorPool](#translatorpool)
  - [LiveSession](#livesession)
  - [Model Registry](#model-registry)
  - [Emitter](#emitter)
  - [Errors](#errors)
  - [Typen](#typen)
- [Engine ONNX (`@lite-translator/engine-onnx`)](#engine-onnx-lite-translatorengine-onnx)
  - [createOnnxEngine](#createonnxengine)
  - [WebGPU-Hilfsfunktionen](#webgpu-hilfsfunktionen)
  - [Default Registry & Model IDs](#default-registry--model-ids)

---

## Core (`@lite-translator/core`)

### createTranslator

```ts
function createTranslator(options: TranslatorOptions): Promise<Translator>
```

Erstellt einen `Translator` für ein Sprachpaar. Lädt **kein** Modell — erst beim ersten `translate()`/`preload()`. Wirft `LANGUAGE_PAIR_NOT_SUPPORTED`, wenn kein Engine das Paar unterstützt.

**Parameter — `TranslatorOptions`**

| Feld | Typ | Pflicht | Beschreibung |
|---|---|---|---|
| `from` | `LanguageCode` | ja | Quellsprache (BCP-47-ähnlich, z.B. `"de"`) |
| `to` | `LanguageCode` | ja | Zielsprache |
| `onProgress` | `ProgressCallback` | nein | Callback für Modell-Download/Ladefortschritt |
| `onDebug` | `DebugCallback` | nein | Callback für strukturierte Debug-Events (Lifecycle, Timing, Engine-Internals). Opt-in, kein Overhead wenn abwesend. Siehe [docs/debug-output.md](debug-output.md). |
| `engines` | `TranslationEngine[]` | nein | Explizite Engine-Liste; ohne Angabe werden die global registrierten Defaults verwendet |

**Beispiel**

```ts
import { createTranslator } from "@lite-translator/core";

const translator = await createTranslator({ from: "de", to: "en" });
const result = await translator.translate("Hallo Welt");
console.log(result.text); // "Hello world"
```

---

### Translator

Repräsentiert ein gebundenes Sprachpaar und das gewählte Engine. Wird über `createTranslator()` erstellt.

#### Eigenschaften

| Property | Typ | Beschreibung |
|---|---|---|
| `pair` | `LanguagePair` | Sprachpaar `{ from, to }` (Kopie) |

#### Methoden

##### `preload(): Promise<void>`

Lädt das Modell vorab. Idempotent — mehrfacher Aufruf führt zu nur einem Download.

##### `translate(text: string, options?: TranslateOptions): Promise<TranslationResult>`

Übersetzt einen einzelnen Text. Lädt das Modell bei Bedarf automatisch.

| Parameter | Typ | Beschreibung |
|---|---|---|
| `text` | `string` | Zu übersetzender Text |
| `options.signal` | `AbortSignal` | Abbruch-Signal; bei bereits abgebrochenem Signal wird `TRANSLATION_FAILED` geworfen |

**Rückgabe — `TranslationResult`**

| Feld | Typ | Beschreibung |
|---|---|---|
| `text` | `string` | Übersetzte Text |
| `from` | `LanguageCode` | Quellsprache |
| `to` | `LanguageCode` | Zielsprache |
| `engine` | `string` | ID des verwendeten Engines (z.B. `"onnx"`) |

##### `translateBatch(texts: string[], options?: TranslateOptions): Promise<TranslationResult[]>`

Übersetzt mehrere Texte in einem Aufruf (nativer Batch, falls das Engine dies unterstützt). Die Reihenfolge der Ergebnisse entspricht der Eingabereihenfolge; leere Strings bleiben leer.

##### `t(): (key: string, text?: string) => string`

Gibt eine gebundene `t()`-Funktion für i18n-Stil-Batchübersetzung zurück.

- `t("my.key", "Hallo")` → registriert den Key und gibt den Originaltext synchron zurück.
- `t("my.key")` → gibt den aktuellen Wert zurück (Übersetzung nach `translateAll()`, Original davor, oder der Key selbst als Fallback).

##### `store(): TranslationStore | undefined`

Gibt den reaktiven Store hinter `t()` zurück. Wird lazily beim ersten `t()`-Aufruf erstellt. Frameworks (Angular, React, Vue) subscriben darauf für reaktive Template-Updates.

##### `translateAll(options?: TranslateOptions): Promise<void>`

Übersetzt alle über `t()` registrierten Strings in einem einzigen `translateBatch()`-Aufruf. Nach Auflösung wird der Store mit den übersetzten Werten aktualisiert und alle Subscriber benachrichtigt. Identische Werte werden vor der Inferenz dedupliziert. No-op, wenn nichts registriert ist.

##### `createLiveSession(options?: LiveSessionOptions): LiveSession`

Erstellt eine Live-Übersetzungs-Session für inkrementelle Eingabe (Chat, Speech-to-Text).

| Parameter | Typ | Standard | Beschreibung |
|---|---|---|---|
| `options.debounce` | `number` | `250` | Debounce in Millisekunden |

##### `isReady(): boolean`

`true`, wenn das Modell geladen und sofort einsatzbereit ist.

##### `isCached(): Promise<boolean>`

`true`, wenn das Modell lokal gecacht ist (Offline-Nutzung möglich).

##### `capabilities(): TranslationCapabilities | undefined`

Gibt die aufgelösten Fähigkeiten des Engines zurück (Gerät, dtype, Modell-ID), oder `undefined`, wenn das Engine `capabilities()` nicht implementiert oder das Modell noch nicht geladen ist.

**Rückgabe — `TranslationCapabilities`**

| Feld | Typ | Beschreibung |
|---|---|---|
| `engine` | `string` | Engine-ID, z.B. `"onnx"` |
| `device` | `string \| undefined` | Aufgelöstes Gerät, z.B. `"webgpu"` oder `"wasm"` |
| `dtype` | `string \| undefined` | Aufgelöster Datentyp, z.B. `"fp16"` oder `"bnb4"` |
| `modelId` | `string \| undefined` | Modell-ID des Engines |
| `modelVersion` | `string \| undefined` | Modell-Version, falls bekannt |

##### `removeModel(): Promise<void>`

Entfernt die gecachten Modell-Dateien für dieses Sprachpaar aus dem Browser Cache Storage. Wenn das Modell aktuell geladen ist, wird es vorher disposed — ein nachfolgendes `preload()` lädt die Dateien neu herunter.

Wirft `ENGINE_NOT_SUPPORTED`, wenn das Engine `removeModel()` nicht implementiert.

##### `dispose(): Promise<void>`

Gibt Engine-Ressourcen frei. Der Translator kann danach nicht mehr verwendet werden.

---

### TranslationEngine (Interface)

Engine-unabhängiges Interface. Das Core kennt keine konkrete Implementierung.

```ts
interface TranslationEngine {
  readonly id: string;
  supports(pair: LanguagePair): boolean;
  isCached(pair: LanguagePair): Promise<boolean>;
  load(pair: LanguagePair, onProgress?: ProgressCallback, onDebug?: DebugCallback): Promise<void>;
  translate(text: string, pair: LanguagePair, options?: TranslateOptions): Promise<TranslationResult>;
  translateBatch(texts: string[], pair: LanguagePair, options?: TranslateOptions): Promise<TranslationResult[]>;
  capabilities?(): TranslationCapabilities | undefined;
  removeModel?(pair: LanguagePair): Promise<void>;
  dispose(): Promise<void>;
}
```

| Methode | Beschreibung |
|---|---|
| `id` | Stabile Engine-ID, z.B. `"onnx"` |
| `supports(pair)` | Prüft, ob das Engine das Sprachpaar unterstützt |
| `isCached(pair)` | Prüft, ob das Modell lokal gecacht ist |
| `load(pair, onProgress?, onDebug?)` | Lädt Modell und Runtime. Idempotent. |
| `translate(text, pair, options?)` | Übersetzt einen Text. Lädt lazy bei Bedarf. |
| `translateBatch(texts, pair, options?)` | Übersetzt mehrere Texte. Ergebnis-Reihenfolge = Eingabe-Reihenfolge. Leere Strings bleiben leer. |
| `capabilities?()` | Optional: Gibt die aufgelösten Fähigkeiten zurück (Gerät, dtype, Modell). |
| `removeModel?(pair)` | Optional: Entfernt die gecachten Modell-Dateien für ein Sprachpaar. |
| `dispose()` | Gibt Speicher und Runtime-Ressourcen frei |

---

### Engine-Registrierung

#### `registerDefaultEngine(engine: TranslationEngine): void`

Registriert ein Engine global als Default. Duplikate (gleiche `id`) werden ignoriert. Ermöglicht Convenience-Packages, ein Engine beim Import zu registrieren.

#### `getDefaultEngines(): readonly TranslationEngine[]`

Gibt eine Kopie der global registrierten Default-Engines zurück.

#### `withBatchFallback(engine: TranslationEngine): TranslationEngine`

Wrappt ein Engine, sodass `translateBatch` immer verfügbar ist. Wenn das Engine `translateBatch` bereits implementiert, wird es unverändert zurückgegeben. Andernfalls wird ein Proxy zurückgegeben, dessen `translateBatch` sequenziell `translate()` für jeden Text aufruft.

---

### TranslationStore

Framework-neutraler reaktiver Store für i18n-Stil-Übersetzungs-Keys. Komponenten registrieren Strings via `register(key, text)` und lesen den aktuellen Wert via `get(key)`.

| Methode | Signatur | Beschreibung |
|---|---|---|
| `register` | `(key: string, text: string): string` | Registriert Key mit Originaltext. Gibt den Text synchron zurück. |
| `get` | `(key: string): string \| undefined` | Aktueller Wert; `undefined` falls nie registriert. |
| `set` | `(key: string, translated: string): void` | Setzt übersetzten Wert (intern durch `translateAll()`). |
| `original` | `(key: string): string \| undefined` | Originaltext (ändert sich nie nach `register`). |
| `has` | `(key: string): boolean` | Ob ein Key registriert ist. |
| `entries` | `(): IterableIterator<[string, string]>` | Alle `[key, value]`-Paare (Einfügereihenfolge). |
| `keys` | `(): IterableIterator<string>` | Alle registrierten Keys. |
| `size` | `number` (getter) | Anzahl registrierter Keys. |
| `subscribe` | `(listener: () => void): () => void` | Subscribt auf Änderungen. Gibt Unsubscribe-Funktion zurück. |
| `snapshot` | `(): Record<string, string>` | Gefrorene Kopie des aktuellen Zustands. Gecacht — wiederholte Aufrufe ohne Änderung liefern dieselbe Referenz (für `===`-Vergleich in React `useSyncExternalStore`). |
| `clear` | `(): void` | Entfernt alle registrierten Keys. |

---

### TranslatorPool

Wiederverwendbarer Pool von Translatoren, keyed nach Sprachpaar. Ersetzt das ad-hoc `Map<string, Translator>`-Muster. `switchTo(from, to)` gibt sofort einen gecachten Translator zurück oder erstellt einen neuen.

#### `TranslatorPoolOptions`

| Feld | Typ | Beschreibung |
|---|---|---|
| `engines` | `TranslationEngine[]` | Explizite Engine-Liste; ohne Angabe globale Defaults |
| `onProgress` | `ProgressCallback` | An alle erstellten Translatoren weitergereicht |
| `maxSize` | `number` | Max. Anzahl gecachter Translatoren; LRU-Eviction bei Überschreitung. Default: unbegrenzt |

#### Methoden

| Methode | Signatur | Beschreibung |
|---|---|---|
| `switchTo` | `(from: string, to: string): Promise<Translator>` | Gibt Translator für das Paar zurück (gecacht oder neu erstellt). |
| `get` | `(from: string, to: string): Translator \| undefined` | Gecachter Translator oder `undefined`; erstellt keinen neuen. |
| `current` | `(): Translator \| undefined` | Der aktuell gecachte Translator. |
| `cachedPairs` | `(): string[]` | Alle gecachten Sprachpaar-Keys, z.B. `["de-en"]`. |
| `size` | `number` (getter) | Anzahl gecachter Translatoren. |
| `disposePair` | `(from, to): Promise<void>` | Disposed einen einzelnen Translator und entfernt ihn. |
| `dispose` | `(): Promise<void>` | Disposed alle gecachten Translatoren und leert den Pool. |

**Beispiel**

```ts
import { TranslatorPool } from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

const pool = new TranslatorPool({ engines: [createOnnxEngine()], maxSize: 3 });
const t1 = await pool.switchTo("de", "en");
const t2 = await pool.switchTo("de", "en"); // dieselbe Instanz wie t1
await pool.dispose();
```

---

### LiveSession

Live-Übersetzungs-Session für inkrementelle Eingabe (Chat-Typing, Speech-to-Text). Segmentiert Eingabe an Satzgrenzen, cacht Übersetzungen vollständiger Sätze und übersetzt nur den noch wachsenden Tail neu. Veraltete Ergebnisse werden automatisch verworfen.

#### Events (`LiveSessionEvents`)

| Event | Payload | Beschreibung |
|---|---|---|
| `translation` | `LiveTranslationEvent` | Neue (ggf. partielle) Übersetzung verfügbar |
| `error` | `TranslatorError` | Übersetzung fehlgeschlagen |
| `dispose` | `—` | Session wurde disposed |

#### Methoden

| Methode | Signatur | Beschreibung |
|---|---|---|
| `on` | `(event, listener): () => void` | Subscribt auf Event. Gibt Unsubscribe-Funktion zurück. |
| `once` | `(event, listener): () => void` | Subscribt für einmalige Auslösung. |
| `off` | `(event, listener): void` | Entfernt einen Listener. |
| `update` | `(text: string): void` | Aktualisiert Eingabe und plant debounced Übersetzung. Identische aufeinanderfolgende Eingaben werden übersprungen. Leerstring leert die Session. |
| `clear` | `(): void` | Leert Cache und Pending-Status. Emitiert `translation` mit leerem Inhalt. |
| `dispose` | `(): void` | Bricht Pending ab und gibt Emitter frei. |
| `disposed` | `boolean` (getter) | Ob die Session disposed ist. |

#### `LiveTranslationEvent`

| Feld | Typ | Beschreibung |
|---|---|---|
| `text` | `string` | Vollständige Übersetzung (alle kompletten Segmente + Partial) |
| `source` | `string` | Original-Eingabe, unverändert |
| `partial` | `string` | Übersetzung des letzten, noch wachsenden Segments (leer, wenn vollständig) |
| `segments` | `LiveSegment[]` | Alle Segmente mit Übersetzung und `complete`-Flag |

#### `LiveSegment`

| Feld | Typ | Beschreibung |
|---|---|---|
| `source` | `string` | Originaltext des Segments |
| `translation` | `string` | Übersetzung (leer bis übersetzt) |
| `complete` | `boolean` | Ob das Segment an einer Satzgrenze endet (gecacht, stabil) |

**Beispiel**

```ts
const live = translator.createLiveSession({ debounce: 250 });
live.on("translation", (e) => console.log(e.text));
live.update("Hallo wie geht");
```

#### `splitSegments(input: string): { complete: string[]; partial: string }`

Exportierte Hilfsfunktion: Splittet Eingabe in vollständige Segmente (an Satzgrenzen `.`, `!`, `?`, `;`, Newlines) und einen Partial-Tail.

---

### Model Registry

#### Typen

| Typ | Beschreibung |
|---|---|
| `ModelFile` | `{ url, size?, sha256? }` — downloadbare Modelldatei |
| `ModelDescriptor` | `{ id, version, engine, engineModelId?, files, metadata? }` — Modellbeschreibung |
| `ModelRegistry` | Interface: `getModel(pair): Promise<ModelDescriptor \| undefined>` |
| `StaticModelRegistry` | Erweitert `ModelRegistry` um `getModelSync(pair)` für synchrone `supports()` |

#### Funktionen

| Funktion | Signatur | Beschreibung |
|---|---|---|
| `createStaticRegistry` | `(models: Record<string, ModelDescriptor>): StaticModelRegistry` | Erzeugt einfache statische Registry aus einem Record. |
| `isStaticRegistry` | `(registry: ModelRegistry): registry is StaticModelRegistry` | Type Guard für synchrone Registry. |
| `languagePairKey` | `(pair: LanguagePair): string` | Sprachpaar → Key, z.B. `"de-en"`. |
| `parseLanguagePairKey` | `(key: string): LanguagePair` | Key → `{ from, to }`. |
| `preloadRegistry` | `(registry: ModelRegistry): Promise<StaticModelRegistry>` | Lädt asynchrone Registry in statische. |

---

### Emitter

Minimaler, framework-neutraler, typisierter Event-Emitter. Pure TypeScript, funktioniert in Node und Browser.

```ts
interface Emitter<Events extends ListenerMap> {
  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): () => void;
  once<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): () => void;
  off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => void): void;
  emit<K extends keyof Events>(event: K, ...args: Events[K]): void;
  clear<K extends keyof Events>(event?: K): void;
}
```

#### `createEmitter<Events>(): Emitter<Events>`

Erzeugt neuen typisierten Emitter. Listener werden in Subskriptionsreihenfolge aufgerufen; `emit()` ist synchron.

---

### Errors

#### `ERROR_CODES`

Stabile Fehlercodes für Konsumenten:

| Code | Beschreibung |
|---|---|
| `MODEL_NOT_AVAILABLE` | Modell nicht verfügbar |
| `MODEL_DOWNLOAD_FAILED` | Modell-Download fehlgeschlagen |
| `MODEL_LOAD_FAILED` | Modell-Laden fehlgeschlagen |
| `LANGUAGE_PAIR_NOT_SUPPORTED` | Kein Engine unterstützt das Sprachpaar |
| `ENGINE_NOT_SUPPORTED` | Engine nicht unterstützt |
| `OUT_OF_MEMORY` | Nicht genügend Speicher |
| `TRANSLATION_FAILED` | Übersetzung fehlgeschlagen (auch bei Abort) |
| `OFFLINE_MODEL_MISSING` | Modell offline nicht vorhanden |

#### `TranslatorError extends Error`

| Feld | Typ | Beschreibung |
|---|---|---|
| `code` | `ErrorCode` | Fehlercode aus `ERROR_CODES` |
| `name` | `string` | Stets `"TranslatorError"` |

#### `isTranslatorError(error: unknown): error is TranslatorError`

Type Guard für `TranslatorError`.

#### `formatTranslatorError(err: unknown): string`

Formatiert beliebigen Fehler in konsistenten String: `"Fehler: <code>: <message>"` für `TranslatorError`, sonst `"Fehler: <message>"`.

---

### Typen

| Typ | Beschreibung |
|---|---|
| `LanguageCode` | `string` — BCP-47-ähnlich ohne Region, z.B. `"de"` |
| `LanguagePair` | `{ from: LanguageCode; to: LanguageCode }` |
| `ProgressEvent` | `{ phase: string; loaded: number; total: number; progress: number }` |
| `ProgressCallback` | `(event: ProgressEvent) => void` |
| `TranslateOptions` | `{ signal?: AbortSignal }` |
| `TranslatorOptions` | `{ from, to, onProgress?, onDebug?, engines? }` |
| `TranslationCapabilities` | `{ engine: string; device?: string; dtype?: string; modelId?: string; modelVersion?: string }` |
| `DebugEvent` | Discriminated Union — strukturierte Debug-Events (Lifecycle, Timing, Engine-Internals). Siehe [docs/debug-output.md](debug-output.md). |
| `DebugCallback` | `(event: DebugEvent) => void` |
| `LiveSessionOptions` | `{ debounce?: number }` |

---

## Engine ONNX (`@lite-translator/engine-onnx`)

### createOnnxEngine

```ts
function createOnnxEngine(options?: OnnxEngineOptions): TransformersEngine
```

Erstellt ein lokales ONNX-Engine (Transformers.js + Web Worker). Default: de-en / en-de (und weitere) mit quantisierten OPUS-MT-Modellen vom HF Hub.

#### `OnnxEngineOptions`

| Feld | Typ | Standard | Beschreibung |
|---|---|---|---|
| `registry` | `StaticModelRegistry` | `createDefaultRegistry(defaultModelIds)` | Custom statische Registry |
| `models` | `Record<string, string>` | `defaultModelIds` | Überschreibt die Sprachpaar→Modell-ID-Mapping |
| `device` | `OnnxDevice` | `"auto"` | Device-Modus: `"auto"` (WebGPU falls verfügbar, sonst WASM), `"webgpu"` (erfordert WebGPU), `"wasm"` |
| `dtype` | `OnnxDtype` | geräteabhängig | Dtype-Override; Default: `"bnb4"` auf WebGPU und WASM |

**Beispiel**

```ts
import { createOnnxEngine } from "@lite-translator/engine-onnx";
import { registerDefaultEngine } from "@lite-translator/core";

registerDefaultEngine(createOnnxEngine({ device: "auto" }));
```

---

### WebGPU-Hilfsfunktionen

| Funktion | Signatur | Beschreibung |
|---|---|---|
| `detectWebGpu` | `(): Promise<boolean>` | Prüft `navigator.gpu` und fordert Adapter an. `false` bei Fehler/Nichtverfügbarkeit. |
| `isFp16Supported` | `(): Promise<boolean>` | Prüft, ob WebGPU-Adapter `shader-f16` unterstützt. |
| `resolveDeviceDtype` | — | Löst Device + Dtype anhand der Capabilities auf. |

#### Typen

| Typ | Werte | Beschreibung |
|---|---|---|
| `OnnxDevice` | `"auto" \| "webgpu" \| "wasm"` | Device-Auswahlmodus |
| `OnnxDtype` | `"fp16" \| "fp32" \| "bnb4" \| "q4f16" \| "auto"` | Dtype-Optionen |
| `ResolvedDevice` | `"webgpu" \| "wasm"` | Konkretes Device nach Auflösung (nie `"auto"`) |
| `ResolvedDtype` | `"fp16" \| "fp32" \| "bnb4" \| "q4f16"` | Konkreter Dtype nach Auflösung (nie `"auto"`) |
| `ResolvedCapabilities` | `{ device: ResolvedDevice; dtype: ResolvedDtype }` | Aufgelöste Capabilities |

> **Hinweis:** `"bnb4"` ist der bewährte quantisierte Dtype auf onnxruntime-web v4 (`q8`/`int8`/`uint8`/`q4` triggern MatMulNBits-Bug; `q4f16` ebenfalls — mit Vorsicht verwenden).

---

### Default Registry & Model IDs

#### `ENGINE_ID`

```ts
const ENGINE_ID = "onnx";
```

Engine-ID; wird in `TranslationResult.engine` verwendet.

#### `defaultModelIds: Record<string, string>`

Default-Sprachmodelle (quantisierte OPUS-MT-Modelle vom HF Hub). Schlüssel sind Sprachpaar-Keys (`"de-en"`, `"en-de"`, `"fr-en"`, `"en-fr"`, `"es-en"`, `"en-es"`, `"it-en"`, `"en-it"`, `"nl-en"`, `"en-nl"`). Können via `createOnnxEngine({ models })` überschrieben oder über `VITE_MODEL_ID_*`-Env-Variablen angepasst werden.

#### `createDefaultRegistry(modelIds: Record<string, string>): StaticModelRegistry`

Erstellt die statische Model-Registry für die übergebenen Paar→Modell-ID-Einträge.