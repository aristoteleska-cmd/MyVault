'use strict';

const assert = require('assert');

/**
 * The switches an Electron window needs to be driveable on a bare build machine.
 *
 * Electron 43 arrived and every clicking test on GitHub's Ubuntu runners
 * stopped, at the first click and every time. The window opens, the renderer
 * runs, the DOM answers and the button is found with the right text on it — and
 * then Playwright waits for the element to hold still, which it does by asking
 * for two animation frames with the same bounding box, and that wait never
 * ends. Thirty seconds later: "waiting for element to be visible, enabled and
 * stable", which says what it was doing and nothing about why.
 *
 * A window whose frames have stopped behaves exactly like that. What stops them
 * on a machine running Xvfb and nothing else — no window manager, no compositor,
 * nobody to say the window is on top — is Chromium deciding for itself that the
 * window is covered, or backgrounded, or not worth drawing, and there are three
 * separate mechanisms that reach that conclusion. All three are turned off here,
 * along with the GPU path, which a build machine does not have in the first
 * place.
 *
 * Which of the four it actually was is not established: this does not reproduce
 * on the container the work was done in, where the same Electron on the same
 * Xvfb clicks fine. So this is aimed at the class rather than the case, and the
 * runner is the only thing that can confirm it. What is certain is the trigger,
 * because the commit that upgraded Electron changed nothing else.
 *
 * None of it applies to a shop, whose window is in front of them on a real
 * desktop with a real window manager and a real graphics card — which is why
 * this belongs to the tests and not to the app.
 */
const HEADLESS_FLAGS = [
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-features=CalculateNativeWinOcclusion',
  '--disable-gpu',
];

/**
 * Fails now, with a reason, instead of in thirty seconds without one.
 *
 * The failure this whole file exists to prevent is uniquely unhelpful when it
 * happens: every click times out saying "waiting for element to be visible,
 * enabled and stable", which is a description of Playwright's own patience and
 * not of anything wrong with MyVault. Somebody reading that in a build log has
 * no reason to suspect the frame loop.
 *
 * So the suites ask the window one question before they touch it — are you
 * drawing? — and say plainly what it means if the answer is no.
 */
async function assertWindowAnimates(window, label = 'the window') {
  const frames = await window.evaluate(() => new Promise((resolve) => {
    let seen = 0;
    // Resolves either way: a window that has stopped drawing will never call
    // the callback back, and a probe that waits for it forever has reproduced
    // the bug it was written to explain.
    const giveUp = setTimeout(() => resolve(seen), 2000);
    const step = () => {
      seen += 1;
      if (seen >= 5) { clearTimeout(giveUp); resolve(seen); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }));

  assert.ok(
    frames >= 5,
    `${label} is not drawing: ${frames} animation frames in two seconds.\n`
    + 'Playwright waits for an element to hold still across two animation frames\n'
    + 'before it will click it, so every click after this point would hang for\n'
    + 'thirty seconds and then time out without explaining itself.\n'
    + 'See HEADLESS_FLAGS at the top of tests/headless.js.',
  );
}

module.exports = { HEADLESS_FLAGS, assertWindowAnimates };
