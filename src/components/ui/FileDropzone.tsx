import { useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from 'react';
import { FileUp, Paperclip, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/format';

interface FileDropzoneProps {
  files: File[];
  onChange: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  maxSizeMb?: number;
  hint?: ReactNode;
  className?: string;
}

/**
 * Click-or-drop file picker. Nothing is uploaded in the prototype — the selected
 * `File` objects are read for their name/size/type and handed to the store.
 */
export function FileDropzone({
  files,
  onChange,
  accept = '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.msg,.eml',
  multiple = true,
  maxSizeMb = 25,
  hint,
  className,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string[]>([]);

  const accept_ = (incoming: FileList | null) => {
    if (!incoming) return;
    const limit = maxSizeMb * 1024 * 1024;
    const kept: File[] = [];
    const tooBig: string[] = [];
    for (const file of Array.from(incoming)) {
      if (file.size > limit) tooBig.push(file.name);
      else kept.push(file);
    }
    setRejected(tooBig);
    onChange(multiple ? [...files, ...kept] : kept.slice(0, 1));
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    accept_(event.dataTransfer.files);
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    accept_(event.target.files);
    event.target.value = '';
  };

  return (
    <div className={className}>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          'rounded-card border-2 border-dashed px-4 py-7 text-center transition-colors',
          dragging ? 'border-brand-500 bg-brand-50' : 'border-ink-250 bg-ink-50/60 hover:border-brand-300',
        )}
      >
        <FileUp className="mx-auto size-6 text-brand-600" aria-hidden />
        <p className="mt-2 text-sm font-medium text-ink-800">
          Drag files here, or{' '}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
          >
            browse your device
          </button>
        </p>
        <p className="mt-1 text-[12px] text-ink-500">
          {hint ?? `PDF, Word, Excel, images and email files up to ${maxSizeMb} MB each.`}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          onChange={onPick}
          className="sr-only"
          tabIndex={-1}
        />
      </div>

      {rejected.length > 0 && (
        <p role="alert" className="mt-2 text-[12px] text-danger-600">
          Skipped {rejected.length === 1 ? rejected[0] : `${rejected.length} files`} — larger than{' '}
          {maxSizeMb} MB.
        </p>
      )}

      {files.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center gap-2.5 rounded-lg bg-white px-3 py-2 ring-1 ring-ink-200"
            >
              <Paperclip className="size-3.5 shrink-0 text-ink-400" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink-800">{file.name}</span>
              <span className="tnum text-[12px] text-ink-500">{formatBytes(file.size)}</span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                aria-label={`Remove ${file.name}`}
                className="rounded p-0.5 text-ink-400 transition-colors hover:text-danger-600"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
