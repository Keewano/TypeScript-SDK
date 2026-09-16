/**
 * Thrown when durable storage cannot exist in this environment: the
 * document directory is absent (Expo Web), `expo-file-system` is not
 * installed, or the installed version no longer exposes the legacy API
 * on either entry point. The init default catches EXACTLY this class to
 * degrade to in-memory storage; any other constructor failure is a real
 * bug and must surface instead of silently downgrading persistence to
 * session-only memory.
 */
class StorageUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageUnavailableError';
  }
}

export { StorageUnavailableError };
