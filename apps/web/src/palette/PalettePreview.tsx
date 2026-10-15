import { MarkdownView } from '../artifacts/MarkdownView.js';
import { ReceiptInspector } from '../artifacts/ReceiptInspector.js';
import type { ArtifactDoc, ReceiptRecord } from '../artifacts/types.js';

export type Preview =
  | { kind: 'doc'; path: string; doc: ArtifactDoc | null; error: string | null }
  | { kind: 'receipt'; id: string; receipt: ReceiptRecord | null; error: string | null };

/** A doc or receipt opened from the palette, in place, with a way back to the results. */
export function PalettePreview({
  preview,
  onBack,
}: {
  preview: Preview;
  onBack: () => void;
}) {
  return (
    <div className="command-palette__preview">
      <button type="button" onClick={onBack} className="command-palette__back">
        ← Back
      </button>
      {preview.kind === 'doc' &&
        (preview.error ? (
          <p role="alert">{preview.error}</p>
        ) : preview.doc ? (
          <MarkdownView content={preview.doc.content} />
        ) : (
          <p>Loading…</p>
        ))}
      {preview.kind === 'receipt' &&
        (preview.error ? (
          <p role="alert">{preview.error}</p>
        ) : preview.receipt ? (
          <ReceiptInspector receipt={preview.receipt} />
        ) : (
          <p>Loading…</p>
        ))}
    </div>
  );
}
