"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders model output as Markdown. Raw HTML is NOT rendered (react-markdown escapes it by default),
 * and links open in a new tab without referrer.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
          img: ({ alt }) => <span>[{alt ?? "image"}]</span>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
