export type AppErrorCode =
  | 'not-signed-in'
  | 'forbidden'
  | 'not-found'
  | 'login-failed'
  | 'locked'
  | 'email-taken'
  | 'link-invalid'
  | 'already-linked'
  | 'wrong-password';

/** An expected failure with a stable code the UI can translate. */
export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    /** Extra data for the message, e.g. seconds until a lock expires. */
    readonly detail?: number,
  ) {
    super(code);
    this.name = 'AppError';
  }
}
