import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const sourcePath = path.join(root, "src", "App.tsx");
const outputPath = path.join(root, "documentation", "LPC1768-BEGINNER-TUTORIAL.md");
const sourceText = fs.readFileSync(sourcePath, "utf8");
const sourceFile = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function propertyName(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  throw new Error(`Unsupported property name: ${node.getText(sourceFile)}`);
}

function literalValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literalValue);
  if (ts.isObjectLiteralExpression(node)) {
    return Object.fromEntries(node.properties.map((property) => {
      if (!ts.isPropertyAssignment(property)) {
        throw new Error(`Unsupported object property: ${property.getText(sourceFile)}`);
      }
      return [propertyName(property.name), literalValue(property.initializer)];
    }));
  }
  throw new Error(`Unsupported literal: ${node.getText(sourceFile).slice(0, 80)}`);
}

function readVariable(name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) {
        return literalValue(declaration.initializer);
      }
    }
  }
  throw new Error(`Variable ${name} was not found in ${sourcePath}`);
}

const course = readVariable("courseSequence");
const details = readVariable("lessonDetails");
const guidance = readVariable("noviceStepGuidance");
const links = readVariable("lessonLinks");

const lines = [];
const add = (...values) => lines.push(...values);
const relativeLink = (url) => url.startsWith("/documentation/") ? `./${url.slice("/documentation/".length)}` : url;

function list(title, items) {
  if (!items?.length) return;
  add(`### ${title}`, "", ...items.map((item) => `- ${item}`), "");
}

function reviewChecklist() {
  add(
    "### Chapter review checklist",
    "",
    "Complete this checklist whenever this chapter is created or changed:",
    "",
    "- [ ] The outcome and prerequisite lessons are still correct.",
    "- [ ] Hardware identity, connector names, pin numbers, addresses, and electrical behavior were checked against the exact-board documentation.",
    "- [ ] A novice is told exactly where to click, which file to open, what to paste, or what physical control to use.",
    "- [ ] Every guided step states the visible result required before continuing.",
    "- [ ] Every guided step includes a recovery action when the result differs.",
    "- [ ] Every referenced local file and external resource opens successfully.",
    "- [ ] Firmware or gateway code was built and exercised when this chapter contains runnable code.",
    "- [ ] Measured, simulated, deterministic, cloud-generated, and AI-generated information is labelled accurately.",
    "- [ ] Safety boundaries remain explicit; the LLM does not control equipment or determine alarms.",
    "- [ ] The chapter was read from beginning to end after the latest change.",
    "",
  );
}

add(
  "# LPC1768 and Application Board: Absolute Beginner Tutorial",
  "",
  "> Hardware: mbed-005.1 NXP LPC1768 module and MSI-0315B / mbed-014.1 Revision B Application Board.",
  ">",
  "> This file is generated from `src/App.tsx`. Run `npm run tutorial:md` after changing any chapter, then complete that chapter's review checklist.",
  "",
  "The course assumes no previous embedded-systems, electronics, PlatformIO, Azure, or AI experience. Follow chapters in order and do not continue past a failed checkpoint.",
  "",
  "## Course sequence",
  "",
  ...course.map((chapter) => `${chapter.number}. [${chapter.title}](#chapter-${chapter.number}-${chapter.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")})`),
  "",
);

for (const chapter of course) {
  const detail = details[chapter.title];
  if (!detail) throw new Error(`Missing lessonDetails entry for ${chapter.title}`);
  const chapterLinks = links[chapter.title] ?? [];
  const chapterGuidance = guidance[chapter.title] ?? [];
  const steps = detail.steps.map((step, index) => ({ ...step, ...chapterGuidance[index] }));

  if (chapterLinks.length !== steps.length) {
    throw new Error(`${chapter.title}: ${steps.length} steps but ${chapterLinks.length} links`);
  }
  if (steps.some((step) => !step.expected || !step.ifNot)) {
    throw new Error(`${chapter.title}: every step must include expected and ifNot guidance`);
  }

  add(
    `## Chapter ${chapter.number}: ${chapter.title}`,
    "",
    `**Phase:** ${chapter.phase}  `,
    `**Category:** ${chapter.category}  `,
    `**Chapter purpose:** ${chapter.description}`,
    "",
    "### Outcome",
    "",
    detail.outcome,
    "",
    `**Hardware/software used:** ${detail.hardware}`,
    "",
  );

  if (detail.estimatedTime) add(`**Estimated time:** ${detail.estimatedTime}`, "");
  if (detail.overview?.length) add("### What you are building", "", ...detail.overview, "");
  list("Prerequisites", detail.prerequisites);

  if (detail.glossary?.length) {
    add("### Beginner vocabulary", "");
    for (const item of detail.glossary) add(`**${item.term}:** ${item.meaning}`, "");
  }

  if (detail.projectFiles?.length) {
    add("### Files and folders", "");
    for (const item of detail.projectFiles) add(`- \`${item.path}\` — ${item.purpose}`);
    add("");
  }

  if (detail.configuration) add("### Project configuration", "", "```ini", detail.configuration, "```", "");
  list("Core concepts", detail.concepts);
  add("### Guided exercise", "");

  steps.forEach((step, index) => {
    const resource = chapterLinks[index];
    add(
      `#### Step ${index + 1}: ${step.title}`,
      "",
      step.detail,
      "",
      `**Continue only when:** ${step.expected}`,
      "",
      `**If you do not see this:** ${step.ifNot}`,
      "",
      `**Reference:** [${resource.label}](${relativeLink(resource.url)})`,
      "",
    );
  });

  if (detail.code) add("### Reference implementation", "", "```" + (detail.codeLanguage ?? "cpp"), detail.code, "```", "");

  if (detail.codeWalkthrough?.length) {
    add("### Code walkthrough", "");
    detail.codeWalkthrough.forEach((item, index) => add(`${index + 1}. **${item.title}:** ${item.detail}`));
    add("");
  }

  list("Expected results", detail.expectedResults);

  if (detail.testCases?.length) {
    add("### Acceptance tests", "", "| # | Action | Expected result |", "|---|---|---|");
    detail.testCases.forEach((test, index) => add(`| ${index + 1} | ${test.action.replaceAll("|", "\\|")} | ${test.expected.replaceAll("|", "\\|")} |`));
    add("");
  }

  if (detail.troubleshooting?.length) {
    add("### Troubleshooting", "");
    detail.troubleshooting.forEach((item) => add(`- **${item.symptom}:** ${item.action}`));
    add("");
  }

  if (detail.safetyNote) add("### Scope and safety", "", detail.safetyNote, "");
  add("### Completion checkpoint", "", detail.checkpoint, "");
  reviewChecklist();
}

fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Generated ${outputPath}`);
