import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { hljs } from '@/lib/highlight';
import { sanitizeHtml } from '@/lib/sanitize';
import { CodeBlockActions } from './CodeBlockActions';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  let highlightedHtml: string | undefined;
  try {
    highlightedHtml = sanitizeHtml(
      hljs.getLanguage(language)
        ? hljs.highlight(code, { language }).value
        : hljs.highlightAuto(code).value,
    );
  } catch {
    highlightedHtml = undefined;
  }

  return (
    <div className="code-block-wrapper">
      <CodeBlockActions code={code} language={language || 'text'} />
      <pre className="hljs">
        {language && <span className="code-lang">{language}</span>}
        {highlightedHtml
          ? <code dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
          : <code>{code}</code>}
      </pre>
    </div>
  );
}

/** Canvas-safe Markdown with GFM, external links, and copyable highlighted code. */
export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  return (
    <div className={`markdown-body ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
          code: ({ className: codeClassName, children, ...props }) => {
            const match = /language-([^ ]+)/.exec(codeClassName || '');
            const code = String(children).replace(/\n$/, '');
            if (match || code.includes('\n')) {
              return <CodeBlock code={code} language={match?.[1] || 'text'} />;
            }
            return <code className={codeClassName} {...props}>{children}</code>;
          },
          table: ({ children }: { children?: ReactNode }) => (
            <div className="table-wrapper"><table className="markdown-table">{children}</table></div>
          ),
          a: ({ children, href, ...props }) => (
            <a {...props} href={href} target="_blank" rel="noopener noreferrer" className="markdown-link">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
