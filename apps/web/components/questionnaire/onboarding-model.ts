import type { Questionnaire, QuestionnairePage } from "@quagga/types";

// The onboarding builder's editing model (A2) and its two-way mapping to the
// stored definition. Pure — shared by the client builder and its tests.
//
// A SECTION is one page of the definition, which the member sees as one step:
//   heading       → page.title
//   body          → an info block (optional)
//   video         → a video LINK card (optional; never an embed — ONBOARD-016)
//   acks          → acknowledgement tick boxes (optional)
// A section must hold at least one of the three, which is the same rule the
// server enforces (a page needs at least one block).

export interface OnboardingSectionModel {
  id: string;
  heading: string;
  subtitle: string;
  body: string;
  video: { title: string; url: string } | null;
  acks: { id: string; prompt: string }[];
}

export function newLocalId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Stored definition → sections. Several info blocks on one page (never made
 * by this builder, but legal) are joined so no text is silently dropped. */
export function sectionsFromDefinition(
  definition: Questionnaire,
): OnboardingSectionModel[] {
  return definition.pages
    .filter(
      (p): p is Extract<QuestionnairePage, { kind: "questions" }> =>
        p.kind === "questions",
    )
    .map((page) => {
      const bodies: string[] = [];
      let video: OnboardingSectionModel["video"] = null;
      const acks: OnboardingSectionModel["acks"] = [];
      for (const block of page.questions) {
        if (block.kind === "info_block") bodies.push(block.body);
        else if (block.kind === "video_link" && !video)
          video = { title: block.title, url: block.url };
        else if (block.kind === "acknowledgement")
          acks.push({ id: block.id, prompt: block.prompt });
      }
      return {
        id: page.id,
        heading: page.title,
        subtitle: page.subtitle ?? "",
        body: bodies.join("\n\n"),
        video,
        acks,
      };
    });
}

/** Sections → the definition the server validates and stores. Block ids are
 * derived from the section id (stable across saves); acknowledgement ids are
 * their own, because they key the member's answers. */
export function definitionFromSections(
  sections: readonly OnboardingSectionModel[],
): Questionnaire {
  return {
    version: "1",
    preset: "onboarding",
    pages: sections.map((s) => {
      const questions: Extract<
        QuestionnairePage,
        { kind: "questions" }
      >["questions"] = [];
      if (s.body.trim()) {
        questions.push({
          id: `${s.id}_info`,
          kind: "info_block",
          body: s.body.trim(),
        });
      }
      if (s.video && (s.video.url.trim() || s.video.title.trim())) {
        questions.push({
          id: `${s.id}_video`,
          kind: "video_link",
          url: s.video.url.trim(),
          title: s.video.title.trim(),
        });
      }
      for (const a of s.acks) {
        questions.push({
          id: a.id,
          kind: "acknowledgement",
          prompt: a.prompt.trim(),
          required: true,
        });
      }
      const page: Extract<QuestionnairePage, { kind: "questions" }> = {
        id: s.id,
        kind: "questions",
        title: s.heading.trim(),
        // Zod requires at least one block; an empty section is reported by
        // `sectionProblem` before this ever reaches the server.
        questions,
      };
      if (s.subtitle.trim()) page.subtitle = s.subtitle.trim();
      return page;
    }),
  };
}

/** What is wrong with a section, in words, or null. Mirrors the server. */
export function sectionProblem(s: OnboardingSectionModel): string | null {
  if (!s.heading.trim()) return "Give this section a heading.";
  const hasVideo = Boolean(s.video && s.video.url.trim());
  if (!s.body.trim() && !hasVideo && s.acks.length === 0)
    return "Add some text, a video link or a tick box.";
  if (s.video && (s.video.url.trim() || s.video.title.trim())) {
    if (!/^https:\/\/\S+$/i.test(s.video.url.trim()))
      return "The video link must start with https://";
    if (!s.video.title.trim()) return "Give the video link a title.";
  }
  if (s.acks.some((a) => !a.prompt.trim()))
    return "Every tick box needs its statement.";
  return null;
}
