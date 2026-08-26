'use strict';

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

module.exports = { HEADLESS_FLAGS };
