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
//   - registration + review state machines + camp-side action resolution
//     (canCampSubmit, canCampWithdraw, resolveCampAction) (./registration-state)
//   - per-section completeness predicates: isSectionComplete,
//     completedSectionsFor (./registration-sections)
//   - sound scale (SOUND_SCALE, isNoAmplifiedSound) (./sound)
//   - placement zones per edition (getPlacementZones) (./placement-zones)
//   - privacy hard-lock: HARD_LOCKED_PRIVATE_FIELDS, enforcePrivacyFlags,
//     privacyViolations, canBePublic (./privacy)
//   - payment references: generatePaymentReference, deriveSubjectCode
//     (./payment-reference)
//   - camp-scoped member ref codes: deriveCampPrefix, disambiguateCampPrefix,
//     formatMemberRefCode, parseMemberRefCode, nextMemberSequence
//     (./member-ref-code)
//   - burner bio code questionnaire: buildBurnerBioQuestionnaire, mapping
//     helpers, BIO_PRIVACY_FIELDS, defaultPrivacyFlags, isBioComplete (./bio)
//   - questionnaire engine: code-side registry + gating helpers
//     (firstBlockingAction, getCodeQuestionnaire) (./questionnaire-engine)
//   - questionnaire Builder v2 definition validation: structural integrity
//     beyond Zod — unique ids, option values, forward-only branch targets
//     (loops/dead-ends rejected), reachability, min/max consistency
//     (validateQuestionnaireDefinition) (./questionnaire-definition)
//   - questionnaire runtime: branch resolution (nextPageId, resolvePath,
//     visibleQuestions), progress/completeness (deriveProgress), branch-aware
//     server-side submit validation (validateSubmission), seeded shuffle
//     (presentationBlocks, presentationOptions) (./questionnaire-runtime)
//   - questionnaire results: per-question aggregation by chart shape — choice
//     counts/percentages, scale + star histograms with averages, boolean
//     splits, date/time timelines, orphan answers (aggregateResponses)
//     (./questionnaire-results)
//   - custom project roles: DEFAULT_PROJECT_ROLES, normalizeRoleName,
//     roleNameConflicts, dedupeRoleNames, defaultProjectRoleRows,
//     officerRoleRows, teamLeadScopePatch, kind guards (./project-roles)
//   - project permissions: hasProjectPermission,
//     canManageQuestionnaireAudience, allProjectPermissions,
//     enforceKindPermissions (./project-permissions)
//   - officer roles: OFFICER_CATALOG, officerRequirements, outstandingOfficers,
//     officerContactVisibleToOrg, soundLevelFromValue (./officers)
//   - audience resolution: resolveAudience + AudienceContext row-set types
//     (./audience)
//   - activation lifecycle: activationRequiredActionKey,
//     buildActivationRequiredActions, completeRequiredAction,
//     isActivationResponseComplete, tallyActivationCompletion
//     (./questionnaire-activation)
//   - questionnaire authz: isOrgAuthor, isProjectAdmin, canAuthorAudience,
//     canActivateAudience, canViewActivationResults, canManageProjectRoles
//     (./questionnaire-authz)
//   - invite redemption: canRedeemInvite(As), single-use logic (./invite)
//   - god-email bootstrap parsing: parseGodEmails, isGodEmailIn (./god-emails)
//   - supplier CSV import: parseCsv, parseSuppliersCsv (./supplier-import)
//   - supplier onboarding: SUPPLIER_ONBOARDING_STEPS, deriveOnboardingProgress,
//     validateStepTransition, applyStepTransition, defaultOnboardingSteps,
//     step-flow guards (./supplier-onboarding)
//   - supplier standing: SUPPLIER_STANDINGS, standing helpers (standingLabel,
//     standingDescription, standingTone), supplierPickerEligibility,
//     filterPickerEligible (./supplier-standing)
//   - supplier import mappers: mapStatusToStanding, mapReturning,
//     normalizeCategory, feePhraseToStepKey (./supplier-import)
//   - notifications + bulletins: payload builders, buildBulletinNotifications
//     (reuses resolveAudience), shouldSendImmediateEmail, groupNotificationsByDay,
//     notificationMentionsAny (privacy guard) (./notifications)
//   - camp categories: CANONICAL_CAMP_CATEGORIES, normalizeCategoryLabel,
//     categoryLabelConflicts, validateCampCategory, countCategoryUsage,
//     matchesCategoryFilter (./camp-categories)
//   - org stats: deriveStatusBoardKpis (burner/camp/MV/artwork cards),
//     deriveRegistrationFunnel, deriveOfficerCoverage,
//     deriveSupplierOnboardingRollup/StandingRollup,
//     deriveQuestionnaireCompletion (./org-stats)
//   - auth capability matrix: AUTH_CAPABILITIES, assertCapability,
//     isCapabilityUnavailable, unavailableCapabilities — what MANAGED Neon Auth
//     actually supports, and the fail-closed gate for what it doesn't
//     (./auth-capabilities)
//   - account security: password policy (assessPassword), enumeration-safe
//     messaging, the 14-day deletion grace state machine, the 48h-revocable
//     email-change state machine, and the sole-lead / sole-god / last-method
//     deletion guards (./account-security)
//   - account sanitization ("Lost Cat"): buildSanitizationPlan,
//     DEPARTED_BURNER_NAME, isSanitized/assertNotSanitized,
//     uncoveredHardLockedFields (./account-sanitization)
//   - security notifications + Resend email bodies: password/email-change/
//     new-device/deletion builders, maskEmail (./security-notifications)
//   - supplier codes: formatSupplierCode (`SUP-2027-0416`), parse/validate,
//     nextSupplierSequence, issueSupplierCode (./supplier-code)
//   - supplier documents: buildDocumentViews, deriveDocumentAckProgress,
//     validateDocumentBinding, applyDocumentAcksToSteps (./supplier-documents)

export * from "./entitlements";
export * from "./name-dedupe";
export * from "./word-count";
export * from "./registration-state";
export * from "./registration-sections";
export * from "./sound";
export * from "./placement-zones";
export * from "./privacy";
export * from "./payment-reference";
export * from "./member-ref-code";
export * from "./bio";
export * from "./questionnaire-engine";
export * from "./questionnaire-definition";
export * from "./questionnaire-runtime";
export * from "./questionnaire-results";
export * from "./project-roles";
export * from "./project-permissions";
export * from "./officers";
export * from "./audience";
export * from "./questionnaire-activation";
export * from "./questionnaire-authz";
export * from "./invite";
export * from "./god-emails";
export * from "./supplier-import";
export * from "./supplier-onboarding";
export * from "./supplier-standing";
export * from "./notifications";
export * from "./camp-categories";
export * from "./org-stats";
export * from "./auth-capabilities";
export * from "./account-security";
export * from "./account-sanitization";
export * from "./security-notifications";
export * from "./supplier-code";
export * from "./supplier-documents";
