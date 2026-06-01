import { useRef, useEffect, forwardRef, useState } from 'react';

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
    const editorRef = useRef<HTMLDivElement>(null);
    const isInternalUpdate = useRef(false);

    useEffect(() => {
      if (editorRef.current && !isInternalUpdate.current && editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value;
      }
      isInternalUpdate.current = false;
    }, [value]);

    const handleInput = () => {
      if (editorRef.current) {
        isInternalUpdate.current = true;
        onChange(editorRef.current.innerHTML);
      }
    };

    return (
      <div
        ref={(node) => {
          editorRef.current = node;
          if (typeof ref === 'function') {
            ref(node);
          } else if (ref) {
            (ref as any).current = node;
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
