import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';

interface Props {
  children: string;
  className?: string;
  compact?: boolean;
}

const components: Components = {
  // Code blocks
  pre({ children }) {
    return (
      <pre className="bg-bg-primary border border-border-default rounded-md p-3 my-2 overflow-x-auto text-[12px] leading-relaxed">
        {children}
      </pre>
    );
  },
  code({ className, children, ...props }) {
    const isBlock = className?.startsWith('language-');
    if (isBlock) {
      return (
        <code className={`font-mono text-[12px] text-text-primary ${className || ''}`} {...props}>
          {children}
        </code>
      );
    }
    // Inline code
    return (
      <code className="font-mono text-[12px] bg-bg-tertiary text-accent-blue px-1 py-0.5 rounded border border-border-default" {...props}>
        {children}
      </code>
    );
  },
  // Headings
  h1({ children }) { return <h1 className="text-base font-bold text-text-primary mt-4 mb-2">{children}</h1>; },
  h2({ children }) { return <h2 className="text-sm font-bold text-text-primary mt-3 mb-1.5">{children}</h2>; },
  h3({ children }) { return <h3 className="text-[13px] font-semibold text-text-primary mt-2.5 mb-1">{children}</h3>; },
  h4({ children }) { return <h4 className="text-[12px] font-semibold text-text-primary mt-2 mb-1">{children}</h4>; },
  // Paragraphs
  p({ children }) { return <p className="text-[13px] text-text-secondary leading-relaxed mb-2 last:mb-0">{children}</p>; },
  // Lists
  ul({ children }) { return <ul className="list-disc list-outside ml-4 mb-2 space-y-0.5">{children}</ul>; },
  ol({ children }) { return <ol className="list-decimal list-outside ml-4 mb-2 space-y-0.5">{children}</ol>; },
  li({ children }) { return <li className="text-[13px] text-text-secondary leading-relaxed">{children}</li>; },
  // Links
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-blue hover:underline">
        {children}
      </a>
    );
  },
  // Blockquotes
  blockquote({ children }) {
    return (
      <blockquote className="border-l-2 border-accent-blue/40 pl-3 my-2 text-text-tertiary italic">
        {children}
      </blockquote>
    );
  },
  // Horizontal rule
  hr() { return <hr className="border-border-default my-3" />; },
  // Strong / em
  strong({ children }) { return <strong className="font-semibold text-text-primary">{children}</strong>; },
  em({ children }) { return <em className="italic text-text-secondary">{children}</em>; },
  // Table
  table({ children }) {
    return (
      <div className="overflow-x-auto my-2">
        <table className="w-full text-[12px] border-collapse">{children}</table>
      </div>
    );
  },
  thead({ children }) { return <thead className="border-b border-border-default">{children}</thead>; },
  th({ children }) { return <th className="text-left px-2 py-1.5 text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">{children}</th>; },
  td({ children }) { return <td className="px-2 py-1.5 text-text-secondary border-b border-border-default">{children}</td>; },
};

const compactComponents: Components = {
  ...components,
  h1({ children }) { return <h1 className="text-[13px] font-bold text-text-primary mt-2 mb-1">{children}</h1>; },
  h2({ children }) { return <h2 className="text-[12px] font-bold text-text-primary mt-2 mb-0.5">{children}</h2>; },
  h3({ children }) { return <h3 className="text-[12px] font-semibold text-text-primary mt-1.5 mb-0.5">{children}</h3>; },
  h4({ children }) { return <h4 className="text-[11px] font-semibold text-text-primary mt-1 mb-0.5">{children}</h4>; },
  p({ children }) { return <p className="text-[12px] text-text-secondary leading-relaxed mb-1 last:mb-0">{children}</p>; },
  ul({ children }) { return <ul className="list-disc list-outside ml-3 mb-1 space-y-0">{children}</ul>; },
  ol({ children }) { return <ol className="list-decimal list-outside ml-3 mb-1 space-y-0">{children}</ol>; },
  li({ children }) { return <li className="text-[12px] text-text-secondary leading-relaxed">{children}</li>; },
  pre({ children }) {
    return (
      <pre className="bg-bg-primary border border-border-default rounded p-2 my-1 overflow-x-auto text-[11px] leading-relaxed font-mono">
        {children}
      </pre>
    );
  },
  code({ className, children, ...props }) {
    const isBlock = className?.startsWith('language-');
    if (isBlock) {
      return (
        <code className={`font-mono text-[11px] text-text-primary ${className || ''}`} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="font-mono text-[11px] bg-bg-tertiary text-accent-blue px-1 py-0.5 rounded border border-border-default" {...props}>
        {children}
      </code>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote className="border-l-2 border-accent-blue/40 pl-2 my-1 text-text-tertiary italic text-[12px]">
        {children}
      </blockquote>
    );
  },
};

export const Markdown: React.FC<Props> = ({ children, className = '', compact = false }) => (
  <div className={`markdown-content ${compact ? 'font-sans' : ''} ${className}`}>
    <ReactMarkdown components={compact ? compactComponents : components}>{children}</ReactMarkdown>
  </div>
);
