# Quagga Portal App Platform

> Ideation document by Graham, received 22 July 2026 via chat paste. Preserved verbatim
> below, including original numbering quirks.
>
> **Working-group status (per Ryan):** held as an **ideation scope / topic map** — a
> survey of camp-life concerns and potential ideas, nothing concrete. Not a feature
> specification. See the reading note in [`docs/synthesis.md`](../synthesis.md) for how
> ideas graduate from it.

---

Quagga Portal App Platform

1. Product Purpose

Quagga Portal App is a management platform for theme camps, villages, collectives and creative projects attending AfrikaBurn or similar participatory Burner events.

The platform must reduce repetitive administration, improve participant onboarding, simplify annual registration and placement submissions, and give camps practical tools to manage their people, budgets, shifts, tickets, Work Access Passes and physical camp layouts.

The system must be modular, but every registered camp must receive the same essential management tools.

More advanced Village, collaboration and creative-project functions can be activated through the settings dashboard.

---

1. Core Modules Required for Every Camp

Every theme camp or collective must have access to the following tools:

1. Camper onboarding
2. Camper database and camp list
3. Shift management
4. Working budget and financial tracking
5. Work Access Pass allocation
6. Ticket allocation and camper ticket status
7. ⁠Tent allocation and placement under Bedouin tent
8. Theme-camp placement and layout design
9. Annual registration and placement submission
10. Previous-year submission records and duplication
11. Camp reporting and statistics

These are the minimum required functions and should not depend on whether the camp is operating independently or as part of a Village.

---

1. Camper Onboarding

Each camp must be able to create a structured onboarding process for new and returning campers.

The onboarding process should include:

* Camp introduction
* Camp culture
* Camp rules
* AfrikaBurn principles
* Participation expectations
* Build responsibilities
* Strike responsibilities
* Shift requirements
* Leave No Trace requirements
* Consent and behaviour policies
* What the camp provides
* What campers must provide themselves
* Payment terms
* Required agreements and acknowledgements

Camp administrators must be able to:

* Add written information
* Add videos
* Upload documents
* Create required acknowledgements
* Set compulsory onboarding steps
* Track onboarding completion
* Prevent incomplete campers from being marked as fully registered
* Update onboarding content annually

The system should distinguish between:

* New campers
* Returning campers
* Camp leads
* Build participants
* Strike participants
* Service providers

Returning campers should not need to repeat unchanged onboarding material unnecessarily. Administrators should be able to require only new or updated sections each year.

---

4. Camper Database and Camp List

Each camp must have a secure camper database.

The camper record should include:

* Full name as shown on ID or passport
* South African ID number or passport number
* Nationality
* Email address
* Mobile number
* Emergency contact
* Profile photograph
* Optional Burner photograph
* Burner name
* Camp role
* Arrival date
* Departure date
* Build attendance
* Strike attendance
* Shift commitments
* Work Access Pass status
* Ticket status
* Camp-fee status
* ⁠Village fee status is applicable
* Onboarding status
* Agreements signed
* Previous event participation
* Relevant skills
* External AfrikaBurn volunteer roles encouraged and noted
* Notes visible only to authorised administrators

The system must allow administrators to:

* Add campers
* Invite campers to complete their own profiles
* Edit camper records
* Import campers from a spreadsheet
* Export camper lists
* Filter campers
* Search campers
* identify missing information
* Identify duplicate records
* Carry returning camper details into the following year
* Archive campers without permanently deleting historical records

Sensitive identity information must be protected through:

* Encryption
* Restricted permissions
* Masked ID and passport numbers
* Audit logs
* Secure access controls
* Defined data-retention periods
* POPIA-compliant consent and processing

Ordinary campers must never be able to view another camper's identity number, passport number, payment information or private administrative notes.

---

5. Camper Statistics

Each camper record should generate participation statistics.

These may include:

* Number of previous Burns attended
* Number of years with the camp
* Number of shifts completed
* Number of shifts missed
* Build participation
* Strike participation
* Internal camp volunteering
* External AfrikaBurn volunteering
* Fees paid
* Fees outstanding
* Onboarding completion
* Ticket status
* Work Access Pass history
* Camp roles held
* Skills volunteered
* Training completed

Camp administrators should have dashboard statistics showing:

* Total campers
* New campers
* Returning campers
* Paid campers
* Outstanding payments
* Completed onboarding
* Incomplete onboarding
* Build-team numbers
* Strike-team numbers
* Filled shifts
* Unfilled shifts
* Allocated tickets
* Unallocated tickets
* Allocated Work Access Passes
* Available Work Access Passes

Camper statistics should support planning and administration. They should not become a public scoring or popularity system.

---

6. Shift Management

Each camp must have a shift-management system.

Administrators should be able to:

* Create shifts
* Create repeating shifts
* Set dates and times
* Set shift duration
* Define the number of participants required
* Assign a shift lead
* Define required skills
* Limit shifts to specific roles
* Mark shifts as compulsory or optional
* Open shifts to the whole camp
* Open shifts across a Village
* Assign campers manually
* Allow self-sign-up
* Track attendance
* Record late cancellations
* Record no-shows

Campers should be able to:

* View available shifts
* Sign up for shifts
* View their personal schedule
* Request a shift swap
* Offer a shift to another camper
* Accept a shift offered by another camper
* Request administrator approval where required
* Receive reminders
* Receive alerts when their shift changes

Reminder options should include:

* In-app notifications
* Email
* WhatsApp, subject to integration availability and consent
* SMS as an optional paid service

The system should prevent shift swaps from being completed unless the replacement camper accepts the shift and meets any required role or skill conditions.

---

 7. Working Budget and Financial Tracking

Every camp must receive a dynamic working budget.

The budget should be customisable but based on standard theme-camp categories and the Mad Hatters Village budget structure.

The budgeting system must include:

* Proposed budget
* Approved budget
* Actual income
* Actual expenditure
* Committed expenditure
* Forecast final expenditure
* Outstanding payments
* Cash available
* Variance against budget
* Cost per camper
* Contingency
* Surplus or shortfall

Income categories may include:

* Camp dues
* Village dues
* Fundraising
* Donations
* Grants
* Sponsorship
* Ticket-related contributions
* Transport contributions
* Other income

Expense categories may include:

* Tents and structures
* Transport
* Storage
* Containers
* Power
* Solar
* Generators
* Water
* Showers
* Toilets
* Kitchens
* Refrigeration
* Bars
* Sound
* Lighting
* Décor
* Art
* Fire and gas
* Labour
* External services
* Security
* Insurance
* Equipment
* Waste
* MOOP
* Build
* Strike
* Contingency

Camp administrators must be able to change:

* Camp name
* Number of campers
* Camper fee
* Cost assumptions
* Budget categories
* Shared Village costs
* External-service costs

Changes must automatically update:

* Total projected income
* Total projected expenditure
* Per-camper costs
* Budget variance
* Cash available
* Camp financial dashboard

The system must allow the camp to move from proposed figures to actual figures without deleting or overwriting the original approved budget.

---

 8. Camp Fees and Payment Gateway

The system should include a payment gateway for:

* Camp dues
* Village dues
* Deposits
* Instalments
* Fundraising contributions
* Transport charges
* Optional services
* Refunds
* Credits

Each camper should see:

* Amount due
* Amount paid
* Outstanding balance
* Due dates
* Instalment schedule
* Receipts
* Refunds
* Credits

Payments should automatically update:

* Camper payment status
* Camp income
* Budget actuals
* Financial reporting

Administrators must also be able to record EFT, cash or manually reconciled payments.

---

 9. Work Access Pass Allocation

The platform must provide a Work Access Pass allocation tool.

Camp administrators should be able to:

* Record the number of Work Access Passes granted
* Create Work Access Pass categories
* Allocate passes to eligible campers
* Record arrival and departure dates
* Record build or strike responsibilities
* Prevent duplicate allocations
* Identify campers with incomplete information
* Track approval status
* Export allocation lists
* Submit data to the ticketing or AfrikaBurn system where integration is available

Work Access Pass eligibility may be linked to:

* Build-team participation
* Strike-team participation
* Functional roles
* Approved arrival date
* Onboarding completion
* Ticket status
* Camp-fee status

The camp should be able to define its own internal approval process, while AfrikaBurn retains final approval over official Work Access Passes.

---

10. Ticket Allocation and Ticket Status

The system must allow camps to manage ticket allocations.

Each camper record should show:

* Whether the camper requires a ticket
* Whether a ticket has been allocated
* Ticket category
* Ticket reference
* Ticket payment status
* Ticket transfer status
* Ticket cancellation status
* Whether the ticket is linked to a Work Access Pass
* Whether the camper has completed the required information

Administrators should be able to:

* Record the camp's total ticket allocation
* Allocate tickets to campers
* Reallocate returned tickets
* Track unused tickets
* Track ticket deadlines
* Export ticket lists
* Identify duplicate camper allocations
* Submit camper details to the event ticketing system

The system should not issue official tickets itself unless formally integrated with the event's ticketing platform.

---

11. Theme-Camp Layout Tool

Every camp must have access to a scaled camp-layout tool.

The tool should allow camps to create a preferred placement plan using accurately sized objects.

Objects should include:

* Bedouin tents
* Stretch tents
* Geodesic domes
* Campers' private tents
* Gazebos
* Shade structures
* Shipping containers
* Trucks
* Cars
* Trailers
* Caravans
* Rooftop tents
* Shower trailers
* Toilets
* Kitchens
* Bars
* Stages
* Sound systems
* Mutant vehicles
* Solar farms
* Generators
* Battery systems
* Water tanks
* Fire installations
* Gas-storage areas
* Waste areas
* Pedestrian pathways
* Emergency lanes
* Fire breaks
* Public frontage
* Private camping areas

Every object should have:

* Width
* Length
* Diameter, where relevant
* Rotation
* Clearance area
* Safety area
* Label
* Notes
* Ownership
* Power requirements
* Water requirements
* Public or private designation

---

# 12. Private Tent Placement Under Bedouin Tents

The layout system must include a dedicated tool for placing different sizes of private tents underneath large Bedouin tents or other communal shade structures.

The user should be able to:

* Select the Bedouin tent size
* Define the usable covered area
* Define support-pole positions
* Define guy-rope and rigging exclusion zones
* Define emergency walkways
* Define entrances and exits
* Select private tent sizes
* Create custom tent sizes
* Drag tents into the covered area
* Rotate private tents
* Automatically arrange tents
* Set spacing between tents
* Reserve access pathways
* Reserve accessible camping spaces
* Calculate how many tents can safely fit

Standard private tent objects could include:

* Small one-person tent
* Two-person tent
* Three-person tent
* Four-person tent
* Large family tent
* Bell tent
* Rooftop tent footprint
* Custom-sized tent

The system should warn users when:

* Tents overlap
* A tent blocks a pathway
* A tent sits on a support-pole position
* A tent intrudes into a rigging zone
* Emergency access is inadequate
* The selected tent arrangement exceeds the usable covered area

The automatic layout tool should prioritise:

1. Emergency access
2. Safe spacing
3. Pole and rigging clearance
4. Fair allocation of space
5. Maximum practical tent capacity

---

# 13. AfrikaBurn Map and Erf Placement

Where AfrikaBurn mapping data is available, the platform should allow the preferred camp layout to be placed on an actual allocated erf.

The system should assess:

* Whether the camp fits
* Erf dimensions
* Road frontage
* Public frontage
* Emergency lanes
* Fire access
* Neighbouring camps
* Sound orientation
* Environmental restrictions
* Vehicle access
* Infrastructure conflicts

If the preferred layout does not fit, the system should be able to suggest:

* Rotating the layout
* Moving objects
* Reducing private camping density
* Reconfiguring public frontage
* Sharing infrastructure
* Assigning a more suitable erf
* Producing a revised layout for camp approval

Theme-camp wranglers or placement staff should be able to send a proposed layout back to the camp through the platform.

The camp should then be able to:

* Approve it
* Reject it
* Comment on it
* Suggest revisions
* Submit an updated version

Final placement decisions remain with AfrikaBurn.

---

# 14. Annual Registration and Placement Submission

The platform must allow a camp to submit its annual registration and placement application.

The submission may include:

* Camp profile
* Camp description
* Camper list
* Camp size
* Public offering
* Interactivity
* Participation plan
* Build plan
* Strike plan
* Budget
* External-service declaration
* Placement layout
* Power information
* Sound information
* Fire information
* Gas information
* Water requirements
* Work Access Pass requirements
* Ticket requirements
* Safety documentation
* Consent and policy confirmations

The platform should track:

* Draft
* Submitted
* Under review
* Changes requested
* Resubmitted
* Approved
* Declined
* Placement allocated
* Final layout approved

---

15. Previous-Year Submissions

The system must store previous registration and placement submissions.

A camp should be able to:

* View all previous submissions
* Duplicate the previous year's submission
* Carry previous camper data forward
* Carry previous budget categories forward
* Carry the previous layout forward
* Carry previous infrastructure data forward
* Carry safety information forward
* Update only the sections that have changed
* Compare the new submission against the previous year
* Clearly identify changed and unchanged information
* Archive each final submitted version

The system should not require camps to rebuild the same application every year where little has changed.

When starting a new event year, the camp should be offered:

* Start a new submission
* Duplicate last year's submission
* Duplicate another previous submission
* Start from a template

Information that may have expired or requires annual confirmation should be flagged.

This could include:

* Camper details
* Safety certificates
* Supplier information
* Insurance
* Fire documentation
* Gas documentation
* Work Access Pass requirements
* Ticket numbers
* Budget figures
* Arrival and departure dates

---
 16. Plug-and-Play and Turnkey Camp Prevention

The platform should support AfrikaBurn's efforts to discourage plug-and-play and turnkey camps.

## Mandatory Baseline Submission

Any theme camp or collective applying for placement should be required to submit:

* A full camper list
* A camp budget
* Camp dues or participation charges
* Build and strike arrangements
* External services being used
* The camp's participant-contribution model
* The camp's public offering or interactivity

This creates a consistent baseline for all placed camps and avoids different rules being applied informally.

## Enhanced Disclosure Triggers

A more detailed disclosure or review should be triggered where a camp:

* Uses substantial external or commercial services
* Has more than 20 participants
* Raises or collects more than R100,000 in camp or Village dues
* Offers accommodation, catering or services that could resemble a turnkey experience
* Has complaints or previous compliance concerns
* Appears to be operating commercially
* Has unusually high per-person charges
* Outsources most build, strike or operational responsibilities

The R100,000 threshold should apply to the total amount raised or collected from participants for that event cycle.

## External-Service Disclosure

Relevant external services may include:

* Full camp setup
* Full camp strike
* Pre-pitched accommodation
* Commercial catering
* Private chefs
* Cleaning teams
* Concierge services
* Transported luggage services
* Private security
* Paid camp management
* Commercial hospitality
* Fully serviced showers or bathrooms
* Paid participant support

The use of professional services should not automatically disqualify a camp.

Legitimate specialist services may be necessary, including:

* Engineering
* Electrical installation
* Rigging
* Plumbing
* Transport
* Heavy machinery
* Fire compliance
* Gas compliance
* Medical support
* Structural installation

The review should determine whether professional assistance supports participation or replaces participation.

## Organisation Review

AfrikaBurn should be able to:

* Review submitted budgets
* Review camper numbers
* Review fees charged
* Review external services
* Request supporting documentation
* Conduct random checks
* Review camps where complaints arise
* Flag unusual or inconsistent information
* Request corrective measures
* Record previous concerns
* Compare submissions across years

The organisation dashboard should provide summaries and risk indicators without automatically exposing unnecessary personal or financial information.

---

17. Village Functionality

Camps may operate independently or activate Village functionality.

Village tools should include:

* Shared camper lists where authorised
* Shared shifts
* Shared infrastructure
* Shared budgets
* Shared functional teams
* Shared announcements
* Shared placement planning
* Shared build and strike teams
* Shared power, water and waste planning
* Cross-camp reporting
* Village-level Work Access Pass planning
* Village-level ticket statistics

Each camp should control which information is shared with the Village.

A camp should be able to collaborate:

* Informally
* Through selected shared functions
* As a fully integrated Village

---

18. Creative Project Mode

The same platform should also support:

* Art projects
* Mutant vehicles
* Performance collectives
* Build crews
* Creative installations
* Fundraising initiatives

Creative Project Mode should use the same core systems:

* Team onboarding
* Participant database
* Roles
* Budgets
* Payments
* Shifts
* Build and strike planning
* Work Access Passes
* Ticket status
* Placement
* Safety documents
* Annual submissions
* Previous-year duplication

---

# 19. Permissions and Security

The platform must use role-based permissions.

Possible roles include:

* Camp lead
* Camp administrator
* Village lead
* Treasurer
* Build captain
* Strike captain
* Functional lead
* Shift lead
* Placement coordinator
* Camper
* Organisation reviewer
* Theme-camp wrangler

Each role must see only the information required to perform its function.

Security requirements should include:

* POPIA-compliant data processing
* Encryption
* Multi-factor authentication
* Audit logs
* Masked identity numbers
* Secure backups
* Access expiration
* Data-retention controls
* Consent records
* Payment security
* Incident and breach procedures

---

# 20. Suggested First Development Release

The first release should focus on the essential camp-management functions:

### Phase 1

* Camp account creation
* User roles
* Camper onboarding
* Camper database
* Camper statistics
* Shift management
* Working budget
* Camp-fee payments
* Work Access Pass allocation
* Ticket allocation
* Camp-list export
* Annual submission forms
* Previous-year duplication
* Basic placement-layout tool
* Standard camp objects
* Private tent placement under Bedouin tents

### Phase 2

* Village functionality
* Cross-camp shifts
* Shared Village budgets
* Advanced reporting
* External-service declarations
* Organisation review dashboard
* AfrikaBurn ticketing integration
* AfrikaBurn map integration
* Automated erf-fit testing

### Phase 3

* AI-assisted layout optimisation
* Automated placement recommendations
* AI budget analysis
* AI shift scheduling
* Resource sharing
* Supplier management
* Asset tracking
* Creative Project Mode
* Offline event functionality

---

# 21. Core Development Principle

The platform should make genuine participation easier and administrative abuse harder.

It should reduce repetitive work without turning theme camps into commercial hospitality operations.

The product must strengthen:

* Participation
* Shared responsibility
* Transparency
* Collaboration
* Culture
* Creativity
* Community
* Accountability

The system should support camps and the organisation while preserving the voluntary, participatory and non-concierge nature of the Burn.
