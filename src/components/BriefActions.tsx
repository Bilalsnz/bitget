'use client';

/**
 * Copy and share actions for a research brief.
 *
 * Both paths serialise through `lib/brief.ts`, so the text that reaches a
 * clipboard and the text that reaches a share sheet are byte-identical — and
 * both carry the provenance line and the research-only disclaimer. A brief
 * leaving the app must not lose the context that makes it honest.
 *
 * Three realities of mobile browsers are handled rather than assumed:
 *
 *   - `navigator.share` exists only on secure contexts, only on some browsers,
 *     and only for some payloads. It is feature-detected at runtime and the
 *     button is simply absent when unavailable, rather than present and broken.
 *   - Cancelling a share sheet rejects with `AbortError`. That is a normal user
 *     action, not a failure, and it must not surface as an error message.
 *   - `navigator.clipboard` is likewise unavailable on some non-secure or older
 *     contexts, so there is a `execCommand` fallback behind it.
 *
 * The card already contains no control that can move money. These two are the
 * only controls the card has ever had, and both only move text.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { briefTitle, briefToText } from '@/lib/brief';
import type { ResearchResult } from '@/lib/types';

type Status = 'idle' | 'copied' | 'share-opened' | 'copy-failed';

/**
 * Copy without the async clipboard API.
 *
 * Older iOS Safari and any non-secure context fall here. The textarea has to be
 * in the document to be selectable, positioned off-screen rather than hidden so
 * iOS still considers it visible.
 */
function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '-9999px';
    document.body.appendChild(area);

    const selection = document.getSelection();
    const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    area.select();
    area.setSelectionRange(0, area.value.length);
    const ok = document.execCommand('copy');

    document.body.removeChild(area);
    // Restoring the reader's selection: they may have been mid-copy themselves.
    if (previous && selection) {
      selection.removeAllRanges();
      selection.addRange(previous);
    }
    return ok;
  } catch {
    return false;
  }
}

export function BriefActions({ result }: { result: ResearchResult }) {
  const [status, setStatus] = useState<Status>('idle');
  const [canShare, setCanShare] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detected after mount, never during render: the server has no navigator, and
  // guessing would produce a hydration mismatch on the one button that matters.
  useEffect(() => {
    setCanShare(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  /** Flash a confirmation, then return to the resting label. */
  const flash = useCallback((next: Status) => {
    setStatus(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus('idle'), 2_400);
  }, []);

  const onCopy = useCallback(async () => {
    const text = briefToText(result);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        flash('copied');
        return;
      }
    } catch {
      // Permission denied or unavailable — fall through to the legacy path
      // rather than reporting a failure the user cannot act on.
    }

    flash(legacyCopy(text) ? 'copied' : 'copy-failed');
  }, [result, flash]);

  const onShare = useCallback(async () => {
    // The full brief, not a summary. The disclaimer and the provenance line are
    // the part most likely to be dropped when text is forwarded, and they are
    // the part that keeps the verdict from reading as advice.
    const text = briefToText(result);

    try {
      await navigator.share({ title: briefTitle(result), text });
      flash('share-opened');
    } catch (err) {
      // AbortError means the reader dismissed the sheet. That is not a failure
      // and must not be reported as one.
      if (err instanceof Error && err.name === 'AbortError') return;

      // Anything else: fall back to the clipboard, which is the useful thing
      // the reader was trying to do anyway.
      void onCopy();
    }
  }, [result, flash, onCopy]);

  const label =
    status === 'copied'
      ? 'Copied'
      : status === 'copy-failed'
        ? 'Copy failed'
        : status === 'share-opened'
          ? 'Shared'
          : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void onCopy()}
        className="min-h-[44px] flex-1 rounded-xl border border-white/12 bg-white/[0.05] px-4 text-sm font-semibold text-slate-200 transition active:scale-[0.98] hover:border-white/25 hover:text-slate-50 sm:flex-none"
      >
        Copy brief
      </button>

      {canShare ? (
        <button
          type="button"
          onClick={() => void onShare()}
          className="min-h-[44px] flex-1 rounded-xl border border-accent-cyan/35 bg-accent-cyan/[0.1] px-4 text-sm font-semibold text-accent-cyan transition active:scale-[0.98] hover:bg-accent-cyan/[0.16] sm:flex-none"
        >
          Share brief
        </button>
      ) : null}

      {/*
        A live region rather than a toast: the confirmation is short, and a
        screen reader announcing "Copied" is the whole feedback mechanism —
        there is no visual change the reader is guaranteed to catch.
      */}
      <p
        role="status"
        aria-live="polite"
        className={`text-xs font-medium ${
          status === 'copy-failed' ? 'text-verdict-avoid' : 'text-verdict-buy'
        }`}
      >
        {label}
      </p>
    </div>
  );
}
