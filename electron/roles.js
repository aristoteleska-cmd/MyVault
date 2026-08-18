'use strict';

/**
 * Who is allowed to do what.
 *
 * This is staff separation, not security. Everything MyVault knows lives in one
 * file on the shop's own PC, so anyone holding that PC can open the file in
 * Notepad or reinstall the program. What roles are for is the ordinary hazard
 * of a shop: the Saturday assistant deleting the category list by accident, or
 * a new starter editing prices while learning the till. They are a guard rail,
 * and the README says so in as many words.
 *
 * What they are not is theatre. The checks below run in the main process, on
 * the far side of the bridge, so a role that cannot delete an item genuinely
 * cannot — hiding the button is only the polite half.
 */

const crypto = require('crypto');

const ROLES = ['admin', 'senior', 'junior'];

/**
 * Every distinct thing a person can do, named after the action rather than the
 * screen, so moving a button never quietly changes who may press it.
 */
const CAPABILITIES = [
  'items.view',
  'items.sell',      // take stock down: something was sold
  'items.receive',   // put stock up: a delivery arrived
  'items.return',    // take something back and hand the money over
  'stocktake.run',   // count the shelves and correct what is wrong
  'items.create',
  'items.edit',
  'items.delete',
  'categories.manage',
  'fields.manage',
  'settings.manage',
  'data.export',
  'data.import',
  'staff.manage',
  'clients.view',    // see the customer list, and say who is being served
  'clients.manage',  // add a regular, correct their phone number, remove them
  'stats.view',      // takings, profit, what is selling and what is not
  'vat.view',        // the shop's tax position, and what it owes
  'documents.manage', // enter an invoice or delivery note and post it to stock
  'pricing.view',     // margins, what a product usually costs, and what to charge
];

/**
 * The matrix, written out in full rather than derived, because "senior is admin
 * minus a few things" is exactly the kind of rule that quietly grants something
 * new the day a capability is added.
 */
const ROLE_CAPABILITIES = {
  // Everything, including who else may do what.
  admin: [...CAPABILITIES],

  // Runs the shop floor: adds products, takes deliveries in, rings sales
  // through. The shape of the catalogue — categories, the extra details, the
  // settings — is not theirs to change.
  //
  // Statistics and the customer list come with the floor: someone reordering
  // stock has to know what is selling, and a regular who walks in should be
  // able to be written down by whoever is standing there. Neither shows them
  // anything they could not already see on a product's own page.
  senior: [
    'items.view',
    'items.sell',
    'items.receive',
    'items.return',
    'items.create',
    'items.edit',
    'data.export',
    'clients.view',
    'clients.manage',
    'stats.view',
    'stocktake.run',
    'documents.manage',
    // Comes with taking deliveries in. Someone typing a supplier's invoice is
    // already looking at what the shop paid, so telling them the cost went up is
    // not showing them anything the paper in their hand does not.
    'pricing.view',
  ],

  // On the till. Look something up, and take one off the shelf when it sells.
  // Nothing else — not adding products, not correcting a count upwards.
  //
  // They can see who the shop's regulars are, because putting a sale against
  // the right customer is the till's job and the alternative is a counter
  // assistant who cannot record half the shop's business. Writing the customer
  // down in the first place is not theirs, and neither is the takings screen.
  // Taking a return is deliberately not theirs. It is the one counter action
  // that hands money back across the counter, and "the customer said they
  // bought it here" is exactly the judgement a shop wants a senior to make.
  junior: [
    'items.view',
    'items.sell',
    'clients.view',
  ],
};

/** True if this role may do this. Unknown roles and capabilities are refused. */
function can(role, capability) {
  const allowed = ROLE_CAPABILITIES[role];
  if (!allowed) return false;
  return allowed.includes(capability);
}

/**
 * What the counter is allowed to call a change of stock, and who may call it that.
 *
 * The reason on a movement is not a label. It decides whether the takings screen
 * counts money, whether the VAT return counts output tax, and whether the
 * statistics call the stock sold or written off. It used to arrive from the
 * window as free text and was passed straight through: someone with nothing but
 * the till could take three bottles off the shelf and file it as a "correction",
 * and the shop's takings, VAT and statistics would all agree that nothing had
 * been sold. The stock is gone, the money is not recorded, and nothing anywhere
 * says so.
 *
 * So each reason names the permission it needs, and each names which way stock
 * is allowed to move under it. A junior has items.sell and nothing else, which
 * now means they may record a sale and cannot describe it as anything else.
 *
 * The reasons the engine writes for itself — new, import, delete, restore — are
 * deliberately absent. They belong to operations that have their own channels
 * and their own permissions, and the window has no business claiming them.
 */
const COUNTER_REASONS = {
  sale: { capability: 'items.sell', direction: 'down' },
  return: { capability: 'items.return', direction: 'up' },
  delivery: { capability: 'items.receive', direction: 'up' },
  correction: { capability: 'items.edit', direction: 'both' },
  stocktake: { capability: 'stocktake.run', direction: 'both' },
};

/**
 * The reason this change of stock may be recorded under.
 *
 * With nothing named, the direction decides — stock going down is a sale, stock
 * coming up is a delivery, exactly as the engine has always defaulted. Anything
 * named has to be a reason this channel knows and has to match the direction the
 * stock is actually moving, so a sale cannot be filed as a delivery to make a
 * shortage disappear.
 */
function requestedReason(named, selling) {
  if (named === undefined || named === null || named === '') {
    return { reason: selling ? 'sale' : 'delivery' };
  }
  // A plain property lookup would answer for "__proto__" and "constructor", and
  // an object with a toString would answer for whatever it printed as while the
  // object itself went on to be recorded — where the log does not recognise it
  // and files it as a correction. Both give exactly the outcome this function
  // exists to prevent, so the value has to be a string and the table has to own
  // the key.
  if (typeof named !== 'string' || !Object.hasOwn(COUNTER_REASONS, named)) {
    throw new Error(`"${named}" is not a reason MyVault records stock under.`);
  }
  const known = COUNTER_REASONS[named];
  if (known.direction === 'down' && !selling) {
    throw new Error(`A ${named} takes stock off the shelf, so it cannot add any.`);
  }
  if (known.direction === 'up' && selling) {
    throw new Error(`A ${named} puts stock on the shelf, so it cannot take any off.`);
  }
  return { reason: named };
}

/**
 * Roles only apply once somebody has set them up.
 *
 * An existing shop that updates to this version has no staff list, and must not
 * find itself locked out of its own stock. With nobody on the list, MyVault
 * behaves exactly as it did before: one person, full access.
 */
function isLocked(users) {
  return Array.isArray(users) && users.length > 0;
}

/** The role in force, given the staff list and whoever is signed in. */
function effectiveRole(users, signedInId) {
  if (!isLocked(users)) return 'admin';
  const user = users.find((candidate) => candidate.id === signedInId);
  return user ? user.role : null;
}

/** Convenience: what the app may do right now. */
function allows(users, signedInId, capability) {
  const role = effectiveRole(users, signedInId);
  return role ? can(role, capability) : false;
}

/**
 * Appearance is nobody's business but the person looking at the screen.
 *
 * Gating the whole settings screen behind a manager would mean a junior on a
 * bright till cannot turn the text up, which is petty and would get the manager
 * PIN written on a sticky note. These few settings change nothing about the
 * shop, so anyone signed in may change them; everything else on that screen —
 * the shop name, the currency, updates, the low-stock limit — needs
 * settings.manage.
 */
const APPEARANCE_SETTINGS = ['theme', 'accent', 'density', 'zoom', 'language'];

/** True when a settings change only alters how the screen looks. */
function isAppearanceOnly(patch) {
  const keys = Object.keys(patch || {});
  return keys.length > 0 && keys.every((key) => APPEARANCE_SETTINGS.includes(key));
}

// --------------------------------------------------------------------- PINs

/**
 * A PIN, because this is a till and not a bank.
 *
 * Four digits is what shop staff will actually use, and a longer minimum only
 * produces a sticky note on the monitor. It is still never stored as typed:
 * staff reuse PINs across their bank card and their phone, and a stock program
 * has no business keeping one in the clear.
 */
const MIN_PIN_LENGTH = 4;
const MAX_PIN_LENGTH = 12;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

function isValidPin(pin) {
  return typeof pin === 'string'
    && /^[0-9]+$/.test(pin)
    && pin.length >= MIN_PIN_LENGTH
    && pin.length <= MAX_PIN_LENGTH;
}

/** Salted scrypt, used for both PINs and recovery codes. */
function hashSecret(secret, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(secret, salt, SCRYPT.keylen, SCRYPT);
  return { salt, hash: derived.toString('hex') };
}

function verifySecret(secret, { salt, hash } = {}) {
  if (typeof secret !== 'string' || !secret) return false;
  if (typeof salt !== 'string' || typeof hash !== 'string') return false;
  let derived;
  try {
    derived = crypto.scryptSync(secret, salt, SCRYPT.keylen, SCRYPT);
  } catch {
    return false;
  }
  const stored = Buffer.from(hash, 'hex');
  if (stored.length !== derived.length) return false;
  return crypto.timingSafeEqual(stored, derived);
}

/** Salted scrypt. The salt is per person, so two identical PINs do not match. */
function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  if (!isValidPin(pin)) {
    throw new Error(`A PIN must be ${MIN_PIN_LENGTH} to ${MAX_PIN_LENGTH} digits.`);
  }
  return hashSecret(pin, salt);
}

/**
 * Constant-time comparison, so the time taken cannot be used to learn the PIN
 * digit by digit. Cheap to do properly, and there is no reason not to.
 */
function verifyPin(pin, stored) {
  if (!isValidPin(pin)) return false;
  return verifySecret(pin, stored);
}

// ---------------------------------------------------------- recovery codes

/**
 * The way back in when the manager's PIN has been forgotten.
 *
 * A four-digit PIN is meant to be forgotten eventually; without an answer to
 * that, a shop would one day be locked out of its own stock and the only advice
 * would be "edit this JSON file", which is no advice at all for a shopkeeper.
 *
 * The alphabet leaves out the characters people mistake for one another when
 * copying a code off a printout — no O against 0, no I or L against 1 — because
 * this gets written on paper and typed back in months later, probably in a
 * hurry.
 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const RECOVERY_GROUPS = 4;
const RECOVERY_GROUP_LENGTH = 5;

/**
 * Twenty characters from a 31-character alphabet: about 99 bits. Nobody is
 * guessing that, which matters because this code is the whole of the way in.
 */
function generateRecoveryCode() {
  const bytes = crypto.randomBytes(RECOVERY_GROUPS * RECOVERY_GROUP_LENGTH);
  const chars = [...bytes].map((byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]);
  const groups = [];
  for (let i = 0; i < RECOVERY_GROUPS; i += 1) {
    groups.push(chars.slice(i * RECOVERY_GROUP_LENGTH, (i + 1) * RECOVERY_GROUP_LENGTH).join(''));
  }
  return groups.join('-');
}

/**
 * Someone reading a code off a piece of paper will lower-case it, lose the
 * dashes, or add a space. None of that should be the reason they stay locked
 * out, so it is all forgiven before comparing.
 */
function normalizeRecoveryCode(code) {
  return String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isValidRecoveryCode(code) {
  const clean = normalizeRecoveryCode(code);
  return clean.length === RECOVERY_GROUPS * RECOVERY_GROUP_LENGTH
    && [...clean].every((character) => RECOVERY_ALPHABET.includes(character));
}

function hashRecoveryCode(code) {
  if (!isValidRecoveryCode(code)) throw new Error('That is not a MyVault recovery code.');
  return hashSecret(normalizeRecoveryCode(code));
}

function verifyRecoveryCode(code, stored) {
  if (!isValidRecoveryCode(code)) return false;
  return verifySecret(normalizeRecoveryCode(code), stored);
}

module.exports = {
  ROLES,
  COUNTER_REASONS,
  requestedReason,
  CAPABILITIES,
  APPEARANCE_SETTINGS,
  isAppearanceOnly,
  ROLE_CAPABILITIES,
  MIN_PIN_LENGTH,
  MAX_PIN_LENGTH,
  can,
  isLocked,
  effectiveRole,
  allows,
  isValidPin,
  hashPin,
  verifyPin,
  RECOVERY_ALPHABET,
  generateRecoveryCode,
  normalizeRecoveryCode,
  isValidRecoveryCode,
  hashRecoveryCode,
  verifyRecoveryCode,
};
