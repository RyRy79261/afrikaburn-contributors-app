# User flows

The journeys the product exists for, as they actually behave. Each names the
code that enforces it, so a diagram that drifts can be caught against a file.

## Arriving: sign-up to a usable account

```mermaid
flowchart TD
    start([Visitor]) --> signup["Sign up<br/>email+password · Google"]
    signup --> verify{"Email<br/>verified?"}
    verify -->|no| resend["Blocked — verify first"]
    verify -->|yes| bio["Burner Bio onboarding"]
    bio --> gate{"Bio complete?"}
    gate -->|no| bio
    gate -->|yes| q{"Blocking<br/>questionnaire?"}
    q -->|yes| fill["Fill it — replaces the whole app"]
    fill --> q
    q -->|no| app([Participant app])

    classDef block fill:#C24438,stroke:#B23A2E,color:#fff
    class resend,fill block
```

A blocking questionnaire replaces the app rather than nagging beside it —
`getBlockingActivation` in `@quagga/core`, applied in each app's route-group
layout. Account management stays reachable throughout: somebody stuck behind a
gate may still need to change a password or sign out a stolen session.

## The core loop: registration and review

Six sections, one state machine, two audiences. This is the journey the product
is for.

```mermaid
stateDiagram-v2
    [*] --> draft: camp created
    draft --> submitted: all 6 sections complete
    submitted --> under_review: org opens it
    under_review --> changes_requested: reviewer asks for a fix
    changes_requested --> submitted: camp edits and resubmits
    under_review --> approved
    under_review --> rejected: reason required
    approved --> withdrawn: camp withdraws
    submitted --> withdrawn
    withdrawn --> draft: reopen — approval NOT restored
    approved --> [*]
    rejected --> [*]
```

The sections are `identity`, `lnt`, `participation`, `size_logistics`,
`sound_placement`, `suppliers_commerce` (`SECTION_KEYS`, `@quagga/types`). A
section is complete when its predicate says so — `isSectionComplete`, not a
manual tick.

Two transitions carry rules worth stating:

- **Reopening a withdrawn registration returns a draft, never the approval.** An
  approval restored without re-review would hand back a placement nobody looked
  at.
- **Rejection requires a reason**, and it reaches the camp with the reason
  attached. A refusal a camp cannot act on is a support ticket in waiting.

The review conversation is per-section and two-way:

```mermaid
sequenceDiagram
    participant C as Camp lead
    participant R as Reviewer
    C->>R: submits registration
    R->>C: comment on §lnt — "who is your LNT lead?"
    Note over R: status → changes_requested
    C->>R: reply on the same thread
    C->>R: edits §lnt, resubmits
    R->>C: approves
    Note over C,R: every action lands in auditEvents
```

## Camps: creation to roster

```mermaid
flowchart LR
    create["Create camp<br/>3 fields"] --> dash["Camp dashboard"]
    dash --> invite["Issue invite link"]
    invite --> join["/join/:token"]
    join --> signedin{"Signed in?"}
    signedin -->|no| auth["Sign up / in"] --> confirm
    signedin -->|yes| confirm["Confirm — this camp, this role"]
    confirm --> member["Member on the roster"]
    member --> roles["Roles & officers"]
    roles --> officer["Officer consents to<br/>phone disclosure"]
```

Officer assignment is **consented, not imposed**: naming somebody as an officer
publishes a contact number to people outside their camp, so it asks first.

## Questionnaires

```mermaid
flowchart TD
    build["Org builds definition<br/>sections · blocks · branching"] --> activate["Activate to an audience"]
    activate --> aud{"Audience"}
    aud --> camps["Camp leads"]
    aud --> art["Art / MV leads"]
    aud --> supp["Suppliers"]
    aud --> orgstaff["Org staff — internal"]
    camps & art & supp & orgstaff --> blocking{"Blocking?"}
    blocking -->|yes| hard["Replaces the app until submitted"]
    blocking -->|no| inbox["Appears as a required action"]
    hard & inbox --> answer["Answers stored per activation"]
    answer --> results["Aggregate results — org"]
```

Audience resolution decides who is asked, and it is a privacy boundary as much
as a routing one: `questionnaire-authz.ts` in `@quagga/core`.

## Suppliers

Seven steps, in `SUPPLIER_ONBOARDING_STEPS`:

```mermaid
flowchart LR
    su["Sign up"] --> link{"Verified email<br/>matches a listing?"}
    link -->|no| unlinked["Unlinked — account works,<br/>portal gated"]
    link -->|yes| portal["Portal"]
    portal --> s1["registration_form"] --> s2["agreement_signed"] --> s3["deposit_paid"]
    s3 --> s4["inventory_submitted"] --> s5["crew_details_submitted"]
    s5 --> s6["briefing_attended"] --> s7["registration_fee_paid"]
    s7 --> standing["Standing — visible to org"]
```

`unlinked` is an ordinary state, not an error. The account exists before the
listing does and outlives it, which is why account management sits outside the
portal gate.

## Reporting a bug

```mermaid
flowchart TD
    pill["Corner pill<br/>bottom-left, every screen"] --> choose{"Bug or feature?"}
    choose -->|bug| disc["Disclosure: the 9 device fields<br/>+ recent errors, shown BEFORE sending"]
    choose -->|feature| none["Nothing about the device is attached"]
    disc & none --> write["Type or dictate"]
    write --> send["Send"]
    send --> screen["Server screens the words<br/>AND the diagnostics"]
    screen --> flag{"Third party in it?"}
    flag -->|yes| withhold["Diagnostics withheld<br/>needs-human, filed verbatim"]
    flag -->|no| structure["Optional: Claude restructures"]
    withhold & structure --> issue["Public GitHub issue<br/>needs-triage · source: in-app"]
    issue --> triage["Auto-triage routine"]

    classDef warn fill:#F4B672,stroke:#D98A2B,color:#332006
    class withhold,screen warn
```

The reporter is only offered where it can work: no `GITHUB_TOKEN`, no pill.
What happens to the issue afterwards is [`triage.md`](triage.md).

## Notifications and bulletins

```mermaid
flowchart LR
    org["Org composes bulletin"] --> audience["Pick audience"]
    audience --> fan["Fan out"]
    fan --> notif["In-app notification"]
    fan --> email["Email — if RESEND_API_KEY"]
    notif --> inbox["/notifications"]
    inbox --> pinned["Pinned banner<br/>until dismissed"]
```

A bulletin reaches its audience and nobody else — the e2e suite asserts the
"nobody else" half, because that is the half that fails quietly.
