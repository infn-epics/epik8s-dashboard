import { useState, useRef, useEffect, useCallback } from 'react';

const THEME_LS_KEY = 'epik8s-theme'; // mirrors useTheme.js's own key

const CLOSE_POLL_MS = 500;

/**
 * window.open()'s features string - pure/testable, unlike the rest of
 * this hook which is real-window/DOM dependent (see the module docstring
 * below for why that's an explicit, accepted test-scope decision here).
 */
export function buildPopupFeatures(width = 420, height = 520) {
  return `width=${width},height=${height},popup=1`;
}

/**
 * usePopoutWindow — pop content out into a real, separate OS/browser
 * window via window.open(), for control-room multi-monitor use (e.g. a
 * widget on a second physical screen while the main dashboard stays on
 * the first). See src/widgets/WidgetFrame.jsx for the call site.
 *
 * Technique: this does NOT load a separate app bundle into the popout -
 * it opens a blank window, clones the current page's stylesheets/theme
 * into its <head>, and creates a container <div> in its <body> for the
 * caller to createPortal(...) into (see WidgetFrame.jsx's 4th portal,
 * alongside its existing 3 same-document ones). React itself keeps
 * running in THIS tab's JS context - the popout is a real OS window, but
 * not an independent process. Two consequences worth knowing:
 *   - Closing the parent tab does not, on its own, close a live popout -
 *     it'd become a frozen, disconnected ghost window. Mitigated below
 *     with a `beforeunload` listener that force-closes it.
 *   - Any widget that reaches for the bare `window` global directly
 *     (rather than an event's own ownerDocument.defaultView) will bind
 *     to THIS window, not the popout's - confirmed live 2026-08-06 as a
 *     real, narrow, pre-existing pattern in
 *     src/widgets/families/bpm/LIBERA-SPP.jsx and
 *     src/widgets/families/rf/STEMLAB125.jsx (their internal drag-to-move
 *     mini-popups use window.addEventListener('mousemove'/'mouseup', ...)
 *     directly) - those two widgets' internal drag will appear stuck when
 *     popped out. Known limitation, not fixed here.
 *
 * Dev-server vs. production build carry a real difference worth testing
 * both: index.html ships zero <link rel="stylesheet"> tags (Vite's dev
 * client injects CSS via dynamically-created <style> tags instead), only
 * the production build uses a <link> - hence cloning BOTH `link[rel=
 * stylesheet]` and `style` elements below, not just one or the other.
 *
 * @param {string} title - synced onto the popout's OS window/taskbar
 *   title on every change (e.g. an operator renaming the widget while
 *   it's popped out) via document.title, not just at open() time.
 * @returns {{ popout: {win: Window, container: HTMLElement} | null, isOpen: boolean, open: () => void, close: () => void }}
 */
export function usePopoutWindow(title) {
  const [popout, setPopout] = useState(null);
  const popoutRef = useRef(null);
  useEffect(() => { popoutRef.current = popout; }, [popout]);

  const open = useCallback(() => {
    if (popout && !popout.win.closed) {
      popout.win.focus();
      return;
    }

    const win = window.open('', '_blank', buildPopupFeatures());
    if (!win) {
      alert('Popup bloccato dal browser - abilita i popup per questo sito per usare questa funzione.');
      return;
    }

    win.document.title = title;
    document.querySelectorAll('head link[rel="stylesheet"], head style').forEach((node) => {
      win.document.head.appendChild(node.cloneNode(true));
    });
    win.document.documentElement.setAttribute('data-theme', localStorage.getItem(THEME_LS_KEY) || 'dark');

    const container = win.document.createElement('div');
    win.document.body.appendChild(container);

    setPopout({ win, container });
  }, [popout, title]);

  const close = useCallback(() => {
    if (popout && !popout.win.closed) popout.win.close();
    setPopout(null);
  }, [popout]);

  // Close-detection: pagehide (fast path) plus a `win.closed` poll -
  // pagehide alone is known-unreliable on some browsers (notably Safari)
  // for detecting a user closing the window via the OS chrome, so the
  // poll is the cross-browser-robust fallback, not a redundant belt.
  useEffect(() => {
    if (!popout) return undefined;
    const { win } = popout;
    const onPagehide = () => setPopout(null);
    win.addEventListener('pagehide', onPagehide, { once: true });
    const pollId = setInterval(() => {
      if (win.closed) setPopout(null);
    }, CLOSE_POLL_MS);
    return () => {
      win.removeEventListener('pagehide', onPagehide);
      clearInterval(pollId);
    };
  }, [popout]);

  // Title sync - keep the OS window/taskbar label in step with a renamed
  // widget while it's popped out (open() only sets it once, at creation).
  useEffect(() => {
    if (popout && !popout.win.closed) popout.win.document.title = title;
  }, [popout, title]);

  // Parent tab closing shouldn't leave a frozen, disconnected ghost
  // window behind - see this hook's module docstring for why the popout
  // can't detect that on its own.
  useEffect(() => {
    const onParentUnload = () => {
      if (popout && !popout.win.closed) popout.win.close();
    };
    window.addEventListener('beforeunload', onParentUnload);
    return () => window.removeEventListener('beforeunload', onParentUnload);
  }, [popout]);

  // Owning component unmounted (e.g. widget removed from the dashboard) -
  // uses the ref, not `popout` directly, so this true-unmount-only effect
  // still closes whatever the LATEST popout was, not a stale one from
  // whenever this effect happened to first run.
  useEffect(() => () => {
    if (popoutRef.current && !popoutRef.current.win.closed) popoutRef.current.win.close();
  }, []);

  return { popout, isOpen: !!popout, open, close };
}
