/**
 * Stands in for posthog-react-native, which Bun can't run. The preload mocks
 * the SDK with it for every test file: `posthog-client.ts` subclasses the
 * SDK's client when it first loads, so a mock set inside one test file misses
 * a client module that another file, such as `analytics-root.test.tsx`,
 * already loaded. Each construction is recorded for tests to read.
 */
export const postHogConstructions: {
  readonly apiKey: string;
  readonly options: Readonly<Record<string, unknown>>;
}[] = [];

class PostHogStandIn {
  constructor(apiKey: string, options: Record<string, unknown>) {
    postHogConstructions.push({ apiKey, options });
  }
  optIn() {
    return Promise.resolve();
  }
  register(_properties: Record<string, unknown>) {
    return Promise.resolve();
  }
}

export const postHogStandIn = () => ({
  default: PostHogStandIn,
  PostHogPersistedProperty: {},
});
