import { useEffect, useRef } from 'react';

/**
 * Escape, for the things on screen that are not dialogs.
 *
 * A dialog looks after its own keyboard: `Modal` traps focus and closes on
 * Escape, and it listens in the capture phase so nothing behind it hears the
 * key. But half of what this program asks is asked without a dialog — the panel
 * that appears under the Add button, the warning strip that asks whether the
 * supplier really should go. Those are ordinary parts of the page, and until
 * now the only way out of them was to find the Cancel button with the mouse.
 *
 * The listener runs in the bubble phase, so an open dialog still wins: it has
 * already stopped the event before this ever sees it. Passing `false` for
 * `active` is the normal state — a panel that is not on screen has no reason to
 * be listening, and nothing is registered until it opens.
 */
export function useEscape(active: boolean, onEscape: () => void): void {
  // Kept in a ref so that a handler written inline at the call site — which is
  // every call site — does not tear the listener down and build it again on
  // every keystroke the shop types into the panel it belongs to.
  const handler = useRef(onEscape);
  handler.current = onEscape;

  useEffect(() => {
    if (!active) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Escape while an input method is mid-word means "throw away what I am
      // spelling", not "throw away the form". MyVault ships in Chinese,
      // Japanese-adjacent scripts and Hindi, where a name is typed through a
      // composition and cancelling it is an ordinary keystroke — closing the
      // panel underneath would take the rest of the form with it.
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      handler.current();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active]);
}
