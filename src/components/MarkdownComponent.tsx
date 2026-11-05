import React, { memo } from 'react';
import Markdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { GeminiSparkleIcon } from './BrandIcons';

export interface MarkdownComponentProps {
  data: string[];
}

const MarkdownComponent: React.FC<MarkdownComponentProps> = ({ data }) => {
  const content = data.filter(Boolean).join('\n\n');
  if (!content) return null;

  return (
    <div className="ds-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          blockquote({ children }) {
            return (
              <div className="ds-callout-quote">
                <span className="ds-callout-icon">
                  <GeminiSparkleIcon size={16} />
                </span>
                <div className="ds-callout-body">{children}</div>
              </div>
            );
          },
          table({ children }) {
            return (
              <div className="ds-table-wrap">
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  );
};

export default memo(MarkdownComponent);
