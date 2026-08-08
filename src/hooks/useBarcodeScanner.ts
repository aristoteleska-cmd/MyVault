import { useEffect, useRef } from 'react';

/**
 * USB barcode readers behave like a very fast keyboard: they "type" the code
 * and press Enter. This watches for that burst anywhere in the app (as long as
 * the user is not typing into a field) and hands the code over, so staff can
 * just scan an item to pull it up instead of clicking into the search box first.
 */
export function useBarcodeScanner(onScan: (code: string) => void, enabled = true) {
  const buffer = useRef('');
  const lastKeyAt = useRef(0);
  const handler = useRef(onScan);
  handler.current = onScan;

  useEffect(() => {
    if (!enabled) return undefined;

    // Real scanners emit keystrokes far faster than a person can type.
    const MAX_GAP_MS = 60;
    const MIN_LENGTH = 4;

    function isTyping(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (isTyping(event.target)) return;

      const now = Date.now();
      if (now - lastKeyAt.current > MAX_GAP_MS) buffer.current = '';
      lastKeyAt.current = now;

      if (event.key === 'Enter') {
        const code = buffer.current;
        buffer.current = '';
        if (code.length >= MIN_LENGTH) {
          event.preventDefault();
          handler.current(code);
        }
        return;
      }

      if (event.key.length === 1) buffer.current += event.key;
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
