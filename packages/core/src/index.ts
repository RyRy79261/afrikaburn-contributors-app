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
//   - THE TWO-FORM SPLIT: Form 1 (September, intent) is what the submit gate
//     asks for; Form 2 (January — size, placement, sound, layout diagram) ships
//     as an org questionnaire whose answers are MIRRORED back into the same
//     registration columns, so the officer requirements derived from the sound
//     answer and every review surface keep reading one source:
//     mapForm2Answers, FORM_2_FIELD_MAP, FORM_2_COLUMNS (./form-2)
//   - sound scale (SOUND_SCALE, isNoAmplifiedSound) (./sound)
//   - placement zones per edition (getPlacementZones) (./placement-zones)
//   - privacy classes: HARD_LOCKED_PRIVATE_FIELDS (no access path),
//     SAFETY_VISIBLE_FIELDS (camp leads + org safety staff),
//     ALWAYS_PRIVATE_FIELDS (union), enforcePrivacyFlags, privacyViolations,
//     canBePublic, isHardLockedPrivate/isSafetyVisibleField (./privacy)
//   - medical access: canViewMedicalNotes, medicalAccessBasis, isOrgStaffRole,
//     MEDICAL_VIEW_AUDIT_ACTION (./medical-access)
//   - ORG CONSOLE PERMISSIONS — the ONE resolver the gate AND the UI read.
//     A person holds zero or more ORG ROLES and `orgCan` resolves the UNION of
//     their permissions; `memberships.role` is only the door, except `god`
//     (the System manager) which resolves everything whatever any row says:
//     orgCan, orgCanIn (department-scoped), orgCanInDomain (what guards ask),
//     isSystemManager, orgCapabilitiesFor, canReadPersonalInformationIn,
//     orgCapabilityRefusal, sanitizeOrgPermissions (./org-permissions)
//   - WHAT A DEPARTMENT OWNS: ORG_DOMAINS — the console's subject areas as the
//     code demonstrably has them — plus the ownership map a System manager fills
//     in (departmentForDomain, domainsOwnedBy, departmentDomainsNote).
//     Departments stay data; the domain list is a fact about this repo
//     (./org-domains)
//   - ORG DEPARTMENTS + ORG ROLES as data: SEEDED_ORG_ROLES (the migrated
//     engineer/org_staff rights), departmentRoleRows (a department's permanent
//     LEAD + MEMBER pair), kind guards, name/key normalizers (./org-roles)
//   - payment references: generatePaymentReference, deriveSubjectCode
//     (./payment-reference)
//   - camp-scoped member ref codes: deriveCampPrefix, disambiguateCampPrefix,
//     formatMemberRefCode, parseMemberRefCode, nextMemberSequence
//     (./member-ref-code)
//   - burner bio code questionnaire: buildBurnerBioQuestionnaire, mapping
//     helpers, BIO_PRIVACY_FIELDS, defaultPrivacyFlags, isBioComplete (./bio)
//   - usernames: the account-level handle that replaced the per-edition playa
//     name — validateUsername (3–20, letter-initial, [a-z0-9_], no edge/double
//     underscore, reserved list), normalizeUsername (the case-insensitive
//     uniqueness key), publicMemberName (THE display fallback) (./username)
//   - questionnaire engine: gating helpers (BURNER_BIO_ACTION_KEY,
//     firstBlockingAction, isParticipantFacingActivation)
//     (./questionnaire-engine)
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
//   - invite landing state: resolveInviteView (valid/used/expired/not-found for
//     signed-out AND signed-in viewers), the token-free auth round trip
//     (PENDING_INVITE_COOKIE, INVITE_RESUME_PATH, authPathForInvite),
//     isWellFormedInviteToken, invitePath, inviteExpiryLabel (./invite-view)
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
//     deriveWranglerCoverage (approved camps with/without a guardian angel,
//     plus the busiest single load — a distribution figure, never a
//     per-person performance one),
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
//   - security events: describeSecurityEvent, SECURITY_EVENT_TITLES — display
//     titles for the account "recent security events" feed (./security-events)
//   - ID retention: identifyPurgeableIdBios, isIdRetentionExpired,
//     buildIdPurgePatch, ID_RETENTION_GRACE_DAYS — POPIA storage-limitation rule
//     for gate-verification ID data after an edition ends (./id-retention)

export * from "./entitlements";
export * from "./name-dedupe";
export * from "./word-count";
export * from "./registration-state";
export * from "./registration-sections";
// Form 2 → registration-row mirroring (roadmap M4-20).
export * from "./form-2";
// In-app bug-report redaction (public issues — see the module header).
export * from "./report-sanitize";
// The reporter's contract and issue assembly. Pure — the handler that talks to
// GitHub, Claude and Groq lives behind the `@quagga/core/report-server`
// subpath so a client bundle importing this barrel never pulls it in.
export * from "./report";
export * from "./report-screen";
export * from "./sound";
export * from "./placement-zones";
export * from "./privacy";
export * from "./medical-access";
export * from "./org-domains";
export * from "./org-permissions";
export * from "./org-roles";
export * from "./payment-reference";
export * from "./member-ref-code";
export * from "./bio";
export * from "./username";
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
export * from "./invite-view";
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
export * from "./security-events";
export * from "./id-retention";
