import {
  AlignLeft,
  Calendar,
  CalendarRange,
  CheckSquare,
  ChevronDown,
  CircleDot,
  Clock,
  Grid3x3,
  Hash,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  Mail,
  Paperclip,
  Phone,
  SlidersHorizontal,
  Star,
  TextCursorInput,
  ToggleLeft,
  Type,
  type LucideIcon,
} from "lucide-react";
import {
  isAnswerableBlock,
  pageBlocks,
  type PageBlock,
  type Question,
  type QuestionnairePage,
  type Questionnaire,
} from "@quagga/types";

// The Builder v2 block palette (questionnaire-spec §"Builder v2 — Google Forms
// parity"). A palette kind is an AUTHORING affordance; several of them map onto
// the same engine kind with a different render variant:
//
//   number        → short_text with format "number"
//   dropdown      → single_select with display "dropdown"
//   image choice  → single_select with display "image_grid"
//
// The engine union in @quagga/types stays the single source of truth; nothing
// here invents a kind the runtime cannot render.

export type PaletteKind =
  | "info_block"
  | "image_block"
  | "short_text"
  | "long_text"
  | "number"
  | "single_select"
  | "dropdown"
  | "image_choice"
  | "multi_select"
  | "multi_choice_grid"
  | "checkbox_grid"
  | "linear_scale"
  | "rating"
  | "boolean"
  | "date"
  | "time"
  | "email"
  | "phone"
  | "file_link"
  | "years";

export interface PaletteEntry {
  kind: PaletteKind;
  label: string;
  group: "content" | "question";
  icon: LucideIcon;
  /** Shown in the block header pill. */
  short: string;
}

export const PALETTE: readonly PaletteEntry[] = [
  {
    kind: "info_block",
    label: "Info text",
    group: "content",
    icon: Type,
    short: "Info text",
  },
  {
    kind: "image_block",
    label: "Image",
    group: "content",
    icon: ImageIcon,
    short: "Image",
  },
  {
    kind: "short_text",
    label: "Short answer",
    group: "question",
    icon: TextCursorInput,
    short: "Short answer",
  },
  {
    kind: "long_text",
    label: "Paragraph",
    group: "question",
    icon: AlignLeft,
    short: "Paragraph",
  },
  {
    kind: "single_select",
    label: "Multiple choice",
    group: "question",
    icon: CircleDot,
    short: "Multiple choice",
  },
  {
    kind: "multi_select",
    label: "Checkboxes",
    group: "question",
    icon: CheckSquare,
    short: "Checkboxes",
  },
  {
    kind: "multi_choice_grid",
    label: "Multiple-choice grid",
    group: "question",
    icon: Grid3x3,
    short: "MC grid",
  },
  {
    kind: "checkbox_grid",
    label: "Checkbox grid",
    group: "question",
    icon: LayoutGrid,
    short: "Checkbox grid",
  },
  {
    kind: "dropdown",
    label: "Dropdown",
    group: "question",
    icon: ChevronDown,
    short: "Dropdown",
  },
  {
    kind: "image_choice",
    label: "Image choices",
    group: "question",
    icon: Images,
    short: "Image choices",
  },
  {
    kind: "linear_scale",
    label: "Linear scale",
    group: "question",
    icon: SlidersHorizontal,
    short: "Linear scale",
  },
  {
    kind: "rating",
    label: "Rating",
    group: "question",
    icon: Star,
    short: "Rating",
  },
  {
    kind: "boolean",
    label: "Yes / No",
    group: "question",
    icon: ToggleLeft,
    short: "Yes / No",
  },
  {
    kind: "number",
    label: "Number",
    group: "question",
    icon: Hash,
    short: "Number",
  },
  {
    kind: "date",
    label: "Date",
    group: "question",
    icon: Calendar,
    short: "Date",
  },
  {
    kind: "time",
    label: "Time",
    group: "question",
    icon: Clock,
    short: "Time",
  },
  {
    kind: "email",
    label: "Email",
    group: "question",
    icon: Mail,
    short: "Email",
  },
  {
    kind: "phone",
    label: "Phone",
    group: "question",
    icon: Phone,
    short: "Phone",
  },
  {
    kind: "file_link",
    label: "File link",
    group: "question",
    icon: Paperclip,
    short: "File link",
  },
  {
    kind: "years",
    label: "Years attended",
    group: "question",
    icon: CalendarRange,
    short: "Years attended",
  },
];

export const PALETTE_BY_KIND = Object.fromEntries(
  PALETTE.map((p) => [p.kind, p]),
) as Record<PaletteKind, PaletteEntry>;

/** The palette kind a stored block presents as (drives the type selector). */
export function blockPaletteKind(block: PageBlock): PaletteKind {
  switch (block.kind) {
    case "single_select":
      if (block.display === "dropdown") return "dropdown";
      if (block.display === "image_grid") return "image_choice";
      return "single_select";
    case "short_text":
      return block.format === "number" || block.format === "integer"
        ? "number"
        : "short_text";
    default:
      return block.kind as PaletteKind;
  }
}

// --- id allocation -------------------------------------------------------
// Question ids key the response map, so they are allocated ONCE, at insert,
// and never recomputed. Reordering moves the object; the id rides along.

/** Every id already claimed in a draft (page ids + block ids share a namespace). */
export function takenIds(draft: Questionnaire): Set<string> {
  const taken = new Set<string>();
  for (const page of draft.pages) {
    taken.add(page.id);
    for (const block of pageBlocks(page)) taken.add(block.id);
  }
  return taken;
}

/** Next free `prefix_n` id. */
export function allocateId(prefix: string, taken: Set<string>): string {
  let n = 1;
  while (taken.has(`${prefix}_${n}`)) n += 1;
  const id = `${prefix}_${n}`;
  taken.add(id);
  return id;
}

// --- factories -----------------------------------------------------------

function defaultOptions(): { value: string; label: string }[] {
  return [
    { value: "option_1", label: "" },
    { value: "option_2", label: "" },
  ];
}

function defaultGridRows(): { id: string; label: string }[] {
  return [
    { id: "row_1", label: "" },
    { id: "row_2", label: "" },
  ];
}

function defaultGridColumns(): { value: string; label: string }[] {
  return [
    { value: "col_1", label: "" },
    { value: "col_2", label: "" },
    { value: "col_3", label: "" },
  ];
}

/** A brand-new block of the given palette kind, with `id` already fixed. */
export function createBlock(kind: PaletteKind, id: string): PageBlock {
  switch (kind) {
    // Empty required strings on purpose: the validator flags them as issues,
    // which is exactly the feedback an author should get before saving.
    case "info_block":
      return { id, kind: "info_block", heading: "", body: "" };
    case "image_block":
      return { id, kind: "image_block", url: "", alt: "" };
    case "short_text":
      return {
        id,
        kind: "short_text",
        prompt: "",
        maxLength: 200,
        required: false,
      };
    case "number":
      return {
        id,
        kind: "short_text",
        prompt: "",
        maxLength: 20,
        required: false,
        format: "number",
      };
    case "long_text":
      return {
        id,
        kind: "long_text",
        prompt: "",
        maxLength: 2000,
        required: false,
      };
    case "single_select":
      return {
        id,
        kind: "single_select",
        prompt: "",
        options: defaultOptions(),
        required: false,
        display: "radio",
      };
    case "dropdown":
      return {
        id,
        kind: "single_select",
        prompt: "",
        options: defaultOptions(),
        required: false,
        display: "dropdown",
      };
    case "image_choice":
      return {
        id,
        kind: "single_select",
        prompt: "",
        options: defaultOptions(),
        required: false,
        display: "image_grid",
      };
    case "multi_select":
      return {
        id,
        kind: "multi_select",
        prompt: "",
        options: defaultOptions(),
        required: false,
        display: "checkbox",
      };
    case "multi_choice_grid":
      return {
        id,
        kind: "multi_choice_grid",
        prompt: "",
        rows: defaultGridRows(),
        columns: defaultGridColumns(),
        required: false,
      };
    case "checkbox_grid":
      return {
        id,
        kind: "checkbox_grid",
        prompt: "",
        rows: defaultGridRows(),
        columns: defaultGridColumns(),
        required: false,
      };
    case "linear_scale":
      return {
        id,
        kind: "linear_scale",
        prompt: "",
        min: 1,
        max: 5,
        required: false,
      };
    case "rating":
      return {
        id,
        kind: "rating",
        prompt: "",
        steps: 5,
        glyph: "star",
        required: false,
      };
    case "boolean":
      return { id, kind: "boolean", prompt: "", required: false };
    case "date":
      return { id, kind: "date", prompt: "", required: false };
    case "time":
      return { id, kind: "time", prompt: "", required: false };
    case "email":
      return { id, kind: "email", prompt: "", required: false };
    case "phone":
      return { id, kind: "phone", prompt: "", required: false };
    case "file_link":
      return { id, kind: "file_link", prompt: "", required: false };
    case "years":
      return { id, kind: "years", prompt: "", required: false };
  }
}

/**
 * Change a block's type in place. The id is PRESERVED — responses already
 * collected stay attached to it — as are prompt, helper, required and (where
 * both sides have them) options.
 */
export function convertBlock(block: PageBlock, kind: PaletteKind): PageBlock {
  const next = createBlock(kind, block.id);
  const prompt = isAnswerableBlock(block) ? block.prompt : "";
  const helper =
    isAnswerableBlock(block) && "helper" in block ? block.helper : undefined;
  const required =
    isAnswerableBlock(block) && "required" in block ? block.required : false;

  if (isAnswerableBlock(next)) {
    const carried: Question = { ...next, prompt, helper, required };
    if (
      (carried.kind === "single_select" || carried.kind === "multi_select") &&
      (block.kind === "single_select" || block.kind === "multi_select") &&
      block.options.length >= 2
    ) {
      // Branch targets are dropped: they are only legal on single choice, and
      // a converted question's options may no longer mean the same thing.
      return {
        ...carried,
        options: block.options.map((o) => ({
          value: o.value,
          label: o.label,
          ...(o.imageUrl ? { imageUrl: o.imageUrl } : {}),
          ...(o.imageAlt ? { imageAlt: o.imageAlt } : {}),
        })),
      };
    }
    return carried;
  }

  if (next.kind === "info_block") {
    return { ...next, heading: prompt || undefined, body: helper ?? "" };
  }
  return next;
}

/** A fresh empty section (page). */
export function createSection(id: string, index: number): QuestionnairePage {
  return {
    id,
    kind: "questions",
    title: `Section ${index + 1}`,
    questions: [],
  };
}

/** Duplicate a block under a fresh id (the copy is a NEW question). */
export function duplicateBlock(block: PageBlock, id: string): PageBlock {
  return { ...block, id } as PageBlock;
}
