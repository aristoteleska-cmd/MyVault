'use strict';

/**
 * Writing so that a power cut leaves the shop with a file rather than a hole.
 *
 * MyVault already wrote its data to a temporary name and renamed it into place,
 * which is the right shape: a rename is atomic, so a reader sees the old file or
 * the new one and never half of either.
 *
 * What it did not do is make sure the bytes were actually on the disk before the
 * rename. On every modern filesystem a write goes to the operating system's
 * cache and reaches the platter when it gets round to it — usually within a few
 * seconds, and not necessarily in the order the writes were made. The rename can
 * therefore be on disk while the data it points at is not, and a shop that loses
 * power at the wrong moment reopens MyVault to a file of the right name and the
 * wrong length. That is the exact fault the rescue path exists to survive, and
 * it is much better not to need it.
 *
 * So: write, flush the file, rename, flush the folder. Two extra system calls on
 * a save that already costs several, measured at a couple of milliseconds on the
 * kind of machine a shop actually has.
 *
 * Flushing the folder is what makes the rename itself durable, and is a POSIX
 * idea — Windows neither needs it nor allows it, and refuses with EPERM or
 * EISDIR. That refusal is expected and ignored; the file's own flush is what
 * matters there.
 */

const fs = require('fs');
const path = require('path');

/** Pushes a directory's own changes — the rename — out of the cache. */
function syncDirectory(directory) {
  let handle;
  try {
    handle = fs.opendirSync(directory);
  } catch {
    return false;
  }
  try {
    // opendir does not expose a descriptor, so open it again as a file. On
    // Windows this throws, which is the case this whole function tolerates.
    const fd = fs.openSync(directory, 'r');
    try {
      fs.fsyncSync(fd);
      return true;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  } finally {
    try { handle.closeSync(); } catch { /* nothing to do about it */ }
  }
}

/**
 * Writes a file so that it is either wholly the old one or wholly the new one,
 * with the new one's bytes genuinely on the disk before the swap.
 *
 * @param {string} file where it should end up
 * @param {string|Buffer} data what to put there
 */
function writeFileDurably(file, data) {
  const temporary = `${file}.tmp`;
  const fd = fs.openSync(temporary, 'w');
  try {
    fs.writeFileSync(fd, data);
    // The bytes, before anything points at them.
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(temporary, file);
  // And the fact that they are now called by the right name.
  syncDirectory(path.dirname(file));
  return file;
}

/**
 * Adds a line to an append-only log and makes sure it is really there.
 *
 * A movement is written after the stock has already moved, so the window between
 * "the shelf changed" and "the history knows" is the one place a sale can go
 * missing without anybody noticing. It is a few hundred bytes; flushing it costs
 * a millisecond or two and closes that window.
 */
function appendDurably(file, line) {
  const fd = fs.openSync(file, 'a');
  try {
    fs.writeFileSync(fd, line);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return file;
}

module.exports = { writeFileDurably, appendDurably, syncDirectory };
