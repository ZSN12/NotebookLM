import { forwardRef, TextareaHTMLAttributes } from 'react';

interface MarkdownEditorProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  onActivate?: (el: HTMLTextAreaElement, setter: (text: string) => void) => void;
  onDeactivate?: () => void;
  textSetter?: (text: string) => void;
}

const MarkdownEditor = forwardRef<HTMLTextAreaElement, MarkdownEditorProps>(
  ({ onActivate, onDeactivate, textSetter, value, onChange, placeholder, rows = 4, ...props }, ref) => {
    return (
      <textarea
        ref={ref}
        value={value}
        onChange={onChange}
        onFocus={(e) => {
          if (onActivate && textSetter) {
            onActivate(e.currentTarget, textSetter);
          }
        }}
        onBlur={() => {
          onDeactivate?.();
        }}
        placeholder={placeholder}
        rows={rows}
        className="w-full p-3 text-sm text-slate-600 dark:text-slate-300 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-yellow-300 leading-relaxed"
        {...props}
      />
    );
  }
);

MarkdownEditor.displayName = 'MarkdownEditor';
export default MarkdownEditor;
