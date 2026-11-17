# Privacy and security

Qalam-Sense handles data about children. Its design goal is that the
smallest possible amount of data exists, on the smallest possible number of
devices, readable by the smallest possible number of people.

## What is processed, and where

| Data | Where | Kept? |
|---|---|---|
| Webcam frames | In memory, on the device, by MediaPipe | **Never stored, never transmitted** |
| Face landmarks, gaze coordinates | In memory during the session | **Never stored** |
| Brightness check | A 32×24 thumbnail once a second, reduced to two numbers | Discarded immediately |
| Session summary (duration, pace, paragraphs visited, adaptations, aggregated indicators, per-sentence dwell time) | IndexedDB on the device | Yes, **encrypted** |
| Reading baseline (3 numbers per language) | IndexedDB | Yes, not encrypted |
| Accounts (login, display name, password verifier) | IndexedDB | Yes |
| Texts, assignments, settings, consents, activity log | IndexedDB | Yes, not encrypted |

The app makes **no network requests** after loading: the vision model, its
WASM runtime and all fonts are served from the app's own origin, and the
production build sets a Content-Security-Policy with `connect-src 'self'`.
There is no analytics, no telemetry and no server.

Gaze-derived data is stored only while a parent's camera consent is in force;
otherwise it is stripped from the summary before encryption.

## Consent

- The camera is **off by default**. Only a parent who has linked the child
  (with the teacher's one-time code) can enable it, after reading what it does.
- Consent is versioned (`CONSENT_POLICY_VERSION`); a policy change invalidates
  older consents.
- Even with consent, the **child chooses at every session** whether to use the
  camera, and can stop it at any time without losing anything.
- Withdrawing consent takes effect at the next session; unlinking a parent
  withdraws the consent they gave.

## Authentication

- Adults: e-mail + password (≥ 8 characters, trivial passwords rejected).
  Students: generated login + 4-digit PIN, issued by the teacher.
- Passwords and PINs are stretched with **PBKDF2-HMAC-SHA256, 600,000
  iterations**, then split with HKDF into a *verifier* (stored) and a
  *key-encryption key* (never stored). Comparison is constant-time.
- **Lockout**: after 5 failures, sign-in is refused for 30 s, doubling up to
  15 min. The same error is returned for unknown users and wrong passwords.
- Sessions expire (student 2 h, parent 4 h, teacher 8 h). The session record,
  with the key-encryption key as a **non-extractable** `CryptoKey`, is kept in
  IndexedDB so a page refresh does not sign the user out.

## Encryption of reading records

- Each student has an **ECDH P-256 key pair**, generated when the teacher
  creates the student.
- Session summaries are encrypted to the **public** key (ephemeral ECDH +
  HKDF + AES-256-GCM). The student's own session can therefore *write*
  records but cannot read any back.
- The **private** key is stored only wrapped (AES-GCM) under the
  key-encryption key of each adult allowed to read: the teacher, and each
  parent who linked with the one-time code. The link code itself is stretched
  with PBKDF2 and is single-use.
- Changing a password re-wraps every key the adult holds, in one transaction.
- There are no hardcoded secrets: every key is random or derived from
  something a person knows.

## Access control

Every service method checks the signed-in role **and** ownership: a teacher
only touches their own students and texts, a parent only children they linked,
a student only their own profile and assigned texts. Integration tests try
every cross-teacher, cross-role and signed-out operation and expect a refusal.
A test also bypasses the services and tries to decrypt another teacher's
records directly: it fails for lack of a key grant.

## Input validation

All user input goes through `security/validation.ts`: Unicode normalisation,
removal of control and bidirectional-override characters (which could disguise
names), length limits, e-mail and PIN formats, age range, text size limits.
Uploaded files must be `.txt` under 200 KB. React escapes all rendered text;
there is no `dangerouslySetInnerHTML`. CSV exports neutralise spreadsheet
formula injection.

## Deletion

| Who | Action | Effect |
|---|---|---|
| Parent | Delete reading records | All session records and baselines of the child, in one transaction |
| Parent | Unlink | Link, the parent's key grant and the consent they gave |
| Parent / teacher | Delete my account (password re-checked) | Teacher: all their students with everything attached, and their texts. Parent: links, grants, consents |
| Teacher | Delete a session / a student | The session / the student and every record that mentions them, including audit entries |
| Anyone signed in | Wipe this device | Deletes the whole IndexedDB database |

Deletion is real deletion from IndexedDB, verified by tests that scan every
store afterwards. The activity log shows parents when their child's records
were viewed, exported or deleted.

## Limits — what this does NOT protect against

Being honest about browser storage:

- **Anyone with the device and the OS account** can open the browser's storage.
  Names, texts, settings and consents are readable there. Session records
  are encrypted, but an attacker can try to guess a teacher's or parent's
  password offline; PBKDF2 slows this down, it does not prevent it.
- **4-digit PINs are weak** (10,000 possibilities). The lockout protects the
  sign-in form, not the stored verifier. This is why students hold no key and
  can read no stored records.
- **No password recovery**: there is no server to recover through. A
  forgotten teacher password means that teacher's access to encrypted records
  is lost (the parent's copy, if any, remains).
- **Malicious browser extensions or malware** on the device can read anything
  the page can read.
- **Clearing site data deletes everything.** There is no backup or sync.
- **One device**: data is not shared between devices or browsers.
- The activity log is local and not tamper-proof.

For deployment beyond a pilot, a school-managed server with proper accounts,
backups and an access log would be needed; see the future work list in the
README.
