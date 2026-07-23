// @quagga/core — pure, framework-agnostic domain logic + validation.
//
// Dependency rule: this package depends ONLY on @quagga/types. It MUST NOT
// import @quagga/db, next/*, server-only, React, read process.env, or perform
// any I/O — that keeps it unit-testable without a DB or route harness and
// reusable by apps/web, apps/org, packages/ui, and tests.
//
// Landed:
//   - entitlements: isRegistered, isApprovedRegistration, isSubmittable,
//     missingSections (./entitlements)
//   - name dedupe: normalizeName, trigramSimilarity, isSimilarName,
//     SIMILARITY_WARN_THRESHOLD (./name-dedupe)
//   - word count: countWords, isWithinWordLimit, wordsRemaining,
//     CAMP_DESCRIPTION_WORD_LIMIT (./word-count)
//   - registration + review state machines (./registration-state)
//   - privacy hard-lock: HARD_LOCKED_PRIVATE_FIELDS, enforcePrivacyFlags,
//     privacyViolations, canBePublic (./privacy)
//   - payment references: generatePaymentReference, deriveSubjectCode
//     (./payment-reference)

export * from "./entitlements";
export * from "./name-dedupe";
export * from "./word-count";
export * from "./registration-state";
export * from "./privacy";
export * from "./payment-reference";
