# Provenance: the `afrikaburn-theme-camp-app/ab-tc-app` fork

| Field                  | Value                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------- |
| **Category**           | Operational                                                                                    |
| **Doc status**         | Record — facts as of 2026-09-26                                                                |
| **Normative language** | None — this document records evidence; it imposes no requirement and draws no legal conclusion |
| **Owner / Updated**    | Ryan Noble, 2026-09-26                                                                         |

This records the evidence that the repository
[`afrikaburn-theme-camp-app/ab-tc-app`](https://github.com/afrikaburn-theme-camp-app/ab-tc-app)
("the fork") was created from this repository,
[`RyRy79261/afrikaburn-contributors-app`](https://github.com/RyRy79261/afrikaburn-contributors-app)
("this repository"), and not the other way round.

Every claim below comes from git objects or the GitHub API and can be
re-checked by anyone with the commands in [How to verify](#how-to-verify).
Git commit IDs are SHA-1 hashes over a commit's content, author, timestamp and
**entire parent history**. Two repositories cannot share a commit ID unless
they share that commit and everything before it.

Fork state examined: `main` at `c1c50c978425670e105be0ad9d563a2f272027d7`
(2026-09-24 12:35 +0200), fetched 2026-09-26.

## Summary

1. **Same root commit.** Both repositories start from the same first commit,
   `5f7d381b857ce0bd128dbf1fcb71c93268d3a573`, authored by RyRy79261 on
   2026-07-26.
2. **This repository's history is inside the fork.** The fork's `main` has 140
   commits. 105 of them are this repository's history, with identical commit
   IDs, ending at this repository's
   `856d29b7496c105c652cfefd7215d778c274cd96`. Only 35 commits are the fork's
   own, and the first of them is dated the day after that point.
3. **The shared history was produced in this repository.** `856d29b` is the
   merge of this repository's pull request
   [#26](https://github.com/RyRy79261/afrikaburn-contributors-app/pull/26):
   same title, and its commit timestamp (2026-09-10 13:23:34 +0200, committer
   `GitHub`) is the exact second GitHub records that PR as merged, by
   RyRy79261 (2026-09-10T11:23:34Z). The same exact-second match holds for the
   other shared commits checked (#11, #28).
4. **Git author fields.** Of the fork's 140 commits, 96 carry the author
   name `RyRy79261` (72) or `Ryan Noble` (24), both with the author email
   `ryanjnoble@gmail.com`. Of the 105 shared commits, 96 carry those values,
   8 carry the fork maintainer's author values (contributed while working in
   this repository) and 1 a review bot's. These are git author-field values,
   not independently verified identities; point 3 is what ties the shared
   history to this repository.
5. **The licence notice is unchanged.** The fork's `LICENSE` still reads
   _"Copyright 2026 Ryan Noble and the Quagga Portal contributors"_
   (FSL-1.1-ALv2), byte-identical to this repository's.
6. **Attribution elsewhere was removed.** The fork's first own commit
   reassigned every code-owner path from `@RyRy79261` to the fork's
   maintainer. A later commit left `AGENTS.md` with no mention of Ryan (6 in
   this repository), and the fork's README, MAINTAINERS, GOVERNANCE and
   CONTRIBUTING do not credit the origin.
7. **The fork's own notes say so.** Its meeting minutes record that prior work
   was "partitioned … into this team's codebase".

## The evidence in detail

### 1. Shared root

```
$ git rev-list --max-parents=0 <fork>/main
5f7d381b857ce0bd128dbf1fcb71c93268d3a573
$ git rev-list --max-parents=0 main
5f7d381b857ce0bd128dbf1fcb71c93268d3a573
```

`5f7d381` — 2026-07-26, RyRy79261, "E2E kickoff path: secure-cookie origin fix,
duplicate-name confirm, selector collisions".

### 2. Where the histories divide

```
$ git merge-base main <fork>/main
856d29b7496c105c652cfefd7215d778c274cd96
$ git rev-list --count 856d29b                 # shared
105
$ git rev-list --count 856d29b..<fork>/main    # fork-only
35
```

The last shared commit is this repository's
`856d29b feat(core,db,web,org): registration-season readiness for R1 (#26)`,
2026-09-10. The first fork-only commit is
`fceaf84 chore(repo): point code owners and security contacts at this org`,
2026-09-11 09:42 +0200.

After the split this repository continued independently (`51b65e2` #29,
`9153da0` #37); neither is in the fork.

### 3. The shared history came from this repository

Spot-checked against the GitHub API: in each case the commit's timestamp is
the exact second this repository's pull request of the same title was merged,
and the merge was performed by RyRy79261.

| Commit (in both repos) | Commit time               | This repository's PR | PR merged (GitHub API) |
| ---------------------- | ------------------------- | -------------------- | ---------------------- |
| `dc8d03d`              | 2026-08-03 12:45:53 +0200 | #11, same title      | 2026-08-03T10:45:53Z   |
| `eda5d3f`              | 2026-09-09 15:47:04 +0200 | #28, same title      | 2026-09-09T13:47:04Z   |
| `856d29b`              | 2026-09-10 13:23:34 +0200 | #26, same title      | 2026-09-10T11:23:34Z   |

The shared history's commit subjects reference pull requests #11, #13, #14,
#15, #16, #17, #19, #20, #22, #23, #25, #26, #27 and #28. The three above were
checked individually; the rest were not.

### 4. Git author-field counts

Across the fork's 140 commits (`git log <fork>/main --format='%an <%ae>'`).
These are the values recorded in each commit's author field:

| Author field                   | Commits | Of which in shared history |
| ------------------------------ | ------: | -------------------------: |
| `RyRy79261`                    |      72 |                         72 |
| `Ryan Noble`                   |      24 |                         24 |
| Fork maintainer (3 addresses)  |      42 |                          8 |
| dependabot / coderabbit (bots) |       2 |                          1 |

### 5. File content

Of the 1,904 files in this repository at `856d29b`, 1,707 are byte-identical
(same path, same blob hash) at the fork's tip. By area: `apps/` 462 of 521,
`packages/` 308 of 361, `e2e/` 78 of 90. Most of the difference is the fork's
own later edits (dependency bumps, CI, docs), not independent work.

### 6. Licence and attribution

- `LICENSE` — no diff between this repository and the fork. Notice line:
  _"Copyright 2026 Ryan Noble and the Quagga Portal contributors"_.
- `fceaf84` (fork, 2026-09-11) — `.github/CODEOWNERS`: every `@RyRy79261`
  entry (migrations, `schema.ts`, `packages/auth`, `packages/core`, `.github/`,
  `LICENSE`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `turbo.json`, SDK
  paths) replaced with the fork maintainer's handle.
- `ff142f1` (fork, 2026-09-11, "governance and community-first documents") —
  after it, the fork's `AGENTS.md` contains no mention of Ryan (this
  repository's contains 6). The fork's `MAINTAINERS.md` lists its maintainer as
  "Sole maintainer".

### 7. The fork's own record

`docs/sources/app-specification/meeting-minutes/2026-09-17-dev-alignment.md`
in the fork (added in its commit `c08eae2`):

- line 22: _"Beyers partitioned his prior work into this team's codebase."_
- line 10 describes Ryan as having "forked independently". The git record
  above shows the reverse direction: the shared history, root commit included,
  was authored and merged in this repository, and the fork diverges from it.

## What this document does not establish

- **Whether GitHub ever listed the fork as a "fork" of this repository.** That
  relationship is platform metadata, not git history; it was not checked.
- **Any legal conclusion** about licence compliance or ownership. This is a
  factual record for whoever needs to make that judgement.

## How to verify

Run from a clone of this repository:

```bash
git fetch https://github.com/afrikaburn-theme-camp-app/ab-tc-app.git \
  main:refs/remotes/fork/main

# Same root
git rev-list --max-parents=0 main fork/main

# This repository's #26 merge is an ancestor of the fork (exit 0 = yes)
git merge-base --is-ancestor 856d29b fork/main && echo "856d29b is in the fork"
git merge-base main fork/main

# Shared vs fork-only
git rev-list --count 856d29b
git rev-list --count 856d29b..fork/main
git log --reverse --format='%h %ad %an %s' --date=iso 856d29b..fork/main | head -3

# Git author fields (name and email)
git log fork/main --format='%an <%ae>' | sort | uniq -c
git log 856d29b   --format='%an <%ae>' | sort | uniq -c

# File content: files at 856d29b, and how many are byte-identical at the fork tip
git ls-tree -r --name-only 856d29b | wc -l
comm -12 <(git ls-tree -r fork/main | awk '{print $3" "$4}' | sort) \
         <(git ls-tree -r 856d29b   | awk '{print $3" "$4}' | sort) | wc -l

# Attribution changes in the fork
git show 856d29b:AGENTS.md   | grep -ci ryan   # 6
git show fork/main:AGENTS.md | grep -ci ryan   # 0
git show fork/main:MAINTAINERS.md | grep -n "Sole maintainer"

# The fork's own minutes (lines 10 and 22)
git show fork/main:docs/sources/app-specification/meeting-minutes/2026-09-17-dev-alignment.md \
  | sed -n '10p;22p'

# Licence notice and code-owner change
git diff main fork/main -- LICENSE
git show fceaf84 -- .github/CODEOWNERS

# The #26 timestamp match
git log -1 --format='%H %cd %cn' --date=iso 856d29b
#   compare: https://github.com/RyRy79261/afrikaburn-contributors-app/pull/26 (merged_at)
```

The results will stay the same only while the fork's history is not rewritten.
If it is rewritten, keep this repository's clone, which holds every shared
commit, and the fork tip ID recorded above.
