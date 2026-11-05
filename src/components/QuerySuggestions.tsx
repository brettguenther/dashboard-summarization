import React, { useContext, useState } from 'react';
import { Check, Copy, ExternalLink, MessageSquarePlus } from 'lucide-react';
import { appConfig } from '../config';
import { useExtensionHost } from '../contexts/ExtensionHostContext';
import { SummaryDataContext } from '../contexts/SummaryDataContext';
import type { QuerySuggestionItem } from '../types';

export const QuerySuggestions: React.FC = () => {
  const { extensionSDK, lookerHostData, isPreviewMode } = useExtensionHost();
  const summaryCtx = useContext(SummaryDataContext);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (!summaryCtx || summaryCtx.querySuggestions.length === 0) {
    return null;
  }

  const { querySuggestions, setToast } = summaryCtx;
  const hostOrigin = lookerHostData?.hostOrigin || lookerHostData?.hostUrl || '';
  const agentId = appConfig.LOOKER_AGENT_ID.trim();
  const agentUrl = agentId
    ? isPreviewMode && hostOrigin
      ? `${hostOrigin.replace(/\/+$/, '')}/agents/${encodeURIComponent(agentId)}`
      : `/agents/${encodeURIComponent(agentId)}`
    : '';

  const copyPrompt = async (prompt: string, index: number) => {
    try {
      await extensionSDK.clipboardWrite(prompt);
    } catch {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(prompt);
      }
    }
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex((prev) => (prev === index ? null : prev)), 2000);
  };

  const handleOpenConversationalAnalytics = async (
    item: QuerySuggestionItem,
    index: number
  ) => {
    await copyPrompt(item.querySuggestion, index);
    if (agentUrl) {
      extensionSDK.openBrowserWindow(agentUrl, '_blank');
      setToast({
        type: 'info',
        text: 'Copied question to clipboard and opened Looker Conversational Analytics.',
      });
    } else {
      setToast({
        type: 'success',
        text: 'Copied follow-up question to clipboard for Conversational Analytics.',
      });
    }
  };

  return (
    <section className="ds-suggestions-section" aria-label="Follow-up analytical questions">
      <div className="ds-section-header">
        <div className="ds-section-title-group">
          <MessageSquarePlus size={16} className="ds-accent-icon" />
          <h3>Suggested Follow-Up Questions</h3>
        </div>
        <span className="ds-section-subtitle">
          {agentUrl
            ? 'Click to copy & launch in Conversational Analytics'
            : 'Click any question to copy for Conversational Analytics'}
        </span>
      </div>

      <div className="ds-suggestions-grid">
        {querySuggestions.map((item, idx) => {
          const isCopied = copiedIndex === idx;
          return (
            <button
              key={`${idx}-${item.querySuggestion.slice(0, 24)}`}
              type="button"
              className="ds-suggestion-card"
              onClick={() => handleOpenConversationalAnalytics(item, idx)}
            >
              <div className="ds-suggestion-top">
                {item.category && <span className="ds-badge ds-badge-neutral">{item.category}</span>}
                <span className="ds-suggestion-action">
                  {isCopied ? (
                    <>
                      <Check size={13} />
                      <span>Copied</span>
                    </>
                  ) : agentUrl ? (
                    <>
                      <ExternalLink size={13} />
                      <span>Ask Agent</span>
                    </>
                  ) : (
                    <>
                      <Copy size={13} />
                      <span>Copy</span>
                    </>
                  )}
                </span>
              </div>
              <p className="ds-suggestion-prompt">{item.querySuggestion}</p>
              {item.rationale && <p className="ds-suggestion-rationale">{item.rationale}</p>}
            </button>
          );
        })}
      </div>
    </section>
  );
};
