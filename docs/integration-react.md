# Integration: React 18

This guide shows how to use `@lite-translator/core` and `@lite-translator/engine-onnx` in a React 18 app.

## Installation

```sh
npm install @lite-translator/core @lite-translator/engine-onnx
```

## Example: Translator component

```tsx
import { useEffect, useRef, useState } from "react";
import { createTranslator, type Translator, type ProgressEvent } from "@lite-translator/core";
import { createOnnxEngine } from "@lite-translator/engine-onnx";

export function TranslatorExample() {
  const [input, setInput] = useState("Hallo Welt, wie geht es dir?");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const translatorRef = useRef<Translator | null>(null);

  // Create the translator on mount and clean up on unmount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const translator = await createTranslator({
        from: "de",
        to: "en",
        engines: [createOnnxEngine()],
        onProgress: (e: ProgressEvent) => {
          if (Number.isFinite(e.progress)) setProgress(e.progress);
        },
      });
      if (cancelled) {
        await translator.dispose();
        return;
      }
      translatorRef.current = translator;
    })();
    return () => {
      cancelled = true;
      void translatorRef.current?.dispose();
      translatorRef.current = null;
    };
  }, []);

  const handleTranslate = async () => {
    const translator = translatorRef.current;
    if (!translator) return;
    setLoading(true);
    setOutput("");
    try {
      const result = await translator.translate(input);
      setOutput(result.text);
    } catch (err) {
      setOutput(`Error: ${(err as { code?: string }).code ?? "UNKNOWN"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: 480, display: "grid", gap: 12 }}>
      <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={4} />
      <button onClick={handleTranslate} disabled={loading}>
        {loading ? "Translating…" : "Translate"}
      </button>
      {loading && <progress max={1} value={progress} style={{ width: "100%" }} />}
      <output style={{ whiteSpace: "pre-wrap" }}>{output}</output>
    </div>
  );
}
```

## Notes

- **Lazy loading:** `createTranslator()` does not load a model yet. Only `translate()` or `preload()` loads the model from the Hugging Face Hub. On the first call, the progress bar appears.
- **Cleanup:** The `useEffect` cleanup calls `dispose()` so the web worker terminates on unmount (otherwise it stays running in the background).
- **Offline:** After the first download, translation works without a network connection. Use `await translator.isCached()` to check whether the model is already stored locally.
- **Multiple language pairs:** Create a separate translator for each language pair (`from`/`to` are bound to the instance).
- **Error codes:** See [packages/core/src/errors.ts](../packages/core/src/errors.ts) — for example, catch `OFFLINE_MODEL_MISSING` to warn users about a missing offline cache.
- **Vite/Create React version:** Both bundlers support the `new URL("./worker.js", import.meta.url)` pattern natively. No extra configuration is needed.