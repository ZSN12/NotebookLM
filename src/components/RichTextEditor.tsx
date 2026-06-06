import { useRef, useEffect, forwardRef } from 'react';
import { sanitizeHTML } from '@/lib/sanitize';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
}

const RichTextEditor = forwardRef<HTMLDivElement, RichTextEditorProps>(
  ({ value, onChange, onFocus, onBlur, placeholder, className }, ref) => {
    const editorRef = useRef<HTMLDivElement | null>(null) as React.MutableRefObject<HTMLDivElement | null>;
    const isInternalUpdate = useRef(false);

    useEffect(() => {
      const safeValue = sanitizeHTML(value || '') as unknown as string;
      if (editorRef.current && !isInternalUpdate.current && editorRef.current.innerHTML !== safeValue) {
        editorRef.current.innerHTML = safeValue;
      }
      isInternalUpdate.current = false;
    }, [value]);

    const handleInput = () => {
      if (editorRef.current) {
        isInternalUpdate.current = true;
        const safeValue = sanitizeHTML(editorRef.current.innerHTML) as unknown as string;
        if (editorRef.current.innerHTML !== safeValue) {
          editorRef.current.innerHTML = safeValue;
        }
        onChange(safeValue);
      }
    };

    return (
      <div
        ref={(node) => {
          editorRef.current = node;
          if (typeof ref === 'function') {
            ref(node);
          } else if (ref) {
            ((ref as unknown) as { current: HTMLDivElement | null }).current = node;
          }
        }}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onFocus={onFocus}
        onBlur={onBlur}
        data-placeholder={placeholder}
        className={className || ''}
        style={{
          minHeight: '200px',
          outline: 'none',
        }}
      />
    );
  }
);

RichTextEditor.displayName = 'RichTextEditor';

export default RichTextEditor;
