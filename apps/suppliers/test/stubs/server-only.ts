// `server-only` throws by design when it is resolved outside a server context.
// Unit tests DO run outside one, so it is aliased to this no-op — see
// vitest.config.ts. The guarantee it enforces is a bundler concern; the module
// under test is still the real one.
export {};
