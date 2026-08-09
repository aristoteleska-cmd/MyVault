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
  'items.create',
  'items.edit',
  'items.delete',
  'categories.manage',
  'fields.manage',
  'settings.manage',
  'data.export',
  'data.import',
  'staff.manage',
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
  senior: [
    'items.view',
    'items.sell',
    'items.receive',
    'items.create',
    'items.edit',
    'data.export',
  ],

  // On the till. Look something up, and take one off the shelf when it sells.
  // Nothing else — not adding products, not correcting a count upwards.
  junior: [
    'items.view',
    'items.sell',
  ],
};

/** True if this role may do this. Unknown roles and capabilities are refused. */
function can(role, capability) {
  const allowed = ROLE_CAPABILITIES[role];
  if (!allowed) return false;
  return allowed.includes(capability);
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

/** Salted scrypt. The salt is per person, so two identical PINs do not match. */
function hashPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  if (!isValidPin(pin)) {
    throw new Error(`A PIN must be ${MIN_PIN_LENGTH} to ${MAX_PIN_LENGTH} digits.`);
  }
  const derived = crypto.scryptSync(pin, salt, SCRYPT.keylen, SCRYPT);
  return { salt, hash: derived.toString('hex') };
}

/**
 * Constant-time comparison, so the time taken cannot be used to learn the PIN
 * digit by digit. Cheap to do properly, and there is no reason not to.
 */
function verifyPin(pin, { salt, hash } = {}) {
  if (!isValidPin(pin) || typeof salt !== 'string' || typeof hash !== 'string') return false;
  let derived;
  try {
    derived = crypto.scryptSync(pin, salt, SCRYPT.keylen, SCRYPT);
  } catch {
    return false;
  }
  const stored = Buffer.from(hash, 'hex');
  if (stored.length !== derived.length) return false;
  return crypto.timingSafeEqual(stored, derived);
}

module.exports = {
  ROLES,
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
};
