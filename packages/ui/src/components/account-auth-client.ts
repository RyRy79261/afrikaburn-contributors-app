// Structural contract for the Better Auth CLIENT methods the shared account-
// security components call. It exists so @quagga/ui can host the 2FA + passkey UI
// for ALL THREE apps (participant, org, suppliers) without taking a hard runtime
// dependency on better-auth: each app passes its own `authClient` (built in
// lib/auth-client.ts with twoFactorClient() + passkeyClient()), and the real
// client structurally satisfies this interface.
//
// The shapes mirror @better-auth 1.6.25 (twoFactor + @better-auth/passkey client
// plugins). Methods are declared as METHODS (bivariant) so the real client — whose
// methods accept extra optional args and return wider discriminated unions — is
// assignable here without `any`.

/** Better Auth client calls resolve to a `{ data, error }` pair, never throw. */
export type ClientResult<T> =
  | { data: T; error: null }
  | { data: null; error: { message?: string | undefined } | null };

/** What `authClient.twoFactor.enable` returns: the TOTP URI + one-time backup codes. */
export interface TwoFactorEnableData {
  totpURI: string;
  backupCodes: string[];
}

/** What `authClient.twoFactor.generateBackupCodes` returns. */
export interface BackupCodesData {
  backupCodes: string[];
  status?: boolean;
}

/** The subset of the Better Auth client the shared account UI depends on. */
export interface AccountAuthClient {
  twoFactor: {
    enable(input: {
      password?: string;
    }): Promise<ClientResult<TwoFactorEnableData>>;
    verifyTotp(input: {
      code: string;
      trustDevice?: boolean;
    }): Promise<ClientResult<unknown>>;
    verifyBackupCode(input: {
      code: string;
      trustDevice?: boolean;
    }): Promise<ClientResult<unknown>>;
    disable(input: { password?: string }): Promise<ClientResult<unknown>>;
    generateBackupCodes(input: {
      password?: string;
    }): Promise<ClientResult<BackupCodesData>>;
  };
  passkey: {
    addPasskey(input?: {
      name?: string;
      authenticatorAttachment?: "platform" | "cross-platform";
    }): Promise<ClientResult<unknown>>;
    deletePasskey(input: { id: string }): Promise<ClientResult<unknown>>;
  };
}

/** Pull a human-readable message out of a client error, with a safe fallback. */
export function clientErrorMessage(
  error: { message?: string | undefined } | null,
  fallback: string,
): string {
  return error?.message?.trim() ? error.message : fallback;
}
