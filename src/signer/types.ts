/**
 * The signer interface — the seam where any signing backend plugs in.
 *
 * ## Why this exists
 *
 * A USSD client holds no key material, so someone else must sign on the
 * account's behalf. This adapter never touches keys itself: everything that
 * needs a signature goes through this interface as **base64 XDR in, signed
 * base64 XDR out**. Key material never crosses the boundary in either
 * direction.
 *
 * ## Substituting a production backend
 *
 * Implement this interface over your own signing infrastructure — an MPC
 * service, an HSM, or a remote co-signing API — and pass your implementation
 * wherever the adapter accepts a `Signer`. Any backend that can produce an
 * Ed25519 signature over a Stellar transaction hash fits. This repository
 * deliberately imports no vendor SDK and names no vendor: the reference
 * implementation ({@link LocalKeypairSigner}) exists only so the adapter can
 * be run and verified without anyone's infrastructure, and it is **not for
 * production**.
 *
 * In Week 2 of the sprint the same `signTransaction` method will be used to
 * co-sign SEP-10 challenge transactions; the interface is defined once so
 * backends written against it do not change.
 */
export interface Signer {
  /**
   * Create signing capability for a brand-new account.
   *
   * The backend generates a keypair inside its own boundary and returns
   * **only the public key** (G...). The adapter uses it as the new account's
   * ID; the secret never leaves the backend.
   */
  createAccountKey(): Promise<string>;

  /**
   * Whether this signer can currently produce signatures for `accountId`.
   *
   * Adapter contract: this is called as a **preflight before transaction
   * construction**, once per required signer, so that a signer that cannot
   * produce a needed signature fails fast with no Horizon round-trip.
   * Implementations should therefore make it cheap (a local capability
   * check, not a network call where avoidable). Returning `true` and then
   * throwing from `signTransaction` is still handled, but defeats the
   * preflight.
   */
  canSignFor(accountId: string): Promise<boolean>;

  /**
   * Sign a transaction envelope.
   *
   * @param xdrBase64 - The transaction envelope, base64-encoded XDR.
   * @param opts.networkPassphrase - Network the signature must bind to.
   * @param opts.accountId - The account whose signature is required. One
   *   envelope may pass through several `signTransaction` calls when
   *   multiple accounts must sign (e.g. sponsor plus sponsored account).
   * @returns The envelope with the requested signature appended, base64 XDR.
   * @throws SignerUnavailableError when the backend cannot sign for `accountId`.
   */
  signTransaction(
    xdrBase64: string,
    opts: { networkPassphrase: string; accountId: string },
  ): Promise<string>;
}
