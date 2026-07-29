import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlockActions } from './CodeBlockActions';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="code-block-wrapper">
      <CodeBlockActions code={code} />
      <pre className="plain-code-block"><code>{code}</code></pre>
    </div>
  );
}

/** Canvas-safe Markdown with GFM, external links, and copyable plain-text code. */
export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  return (
    <div className={`markdown-body ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }: { children?: ReactNode }) => <>{children}</>,
          code: ({ className: codeClassName, children, ...props }) => {
            const rawCode = String(children);
            const code = rawCode.replace(/\n$/, '');
            if (codeClassName?.startsWith('language-') || rawCode.includes('\n')) {
              return <CodeBlock code={code} />;
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
