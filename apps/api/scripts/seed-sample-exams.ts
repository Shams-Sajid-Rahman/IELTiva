// Adds short, original sample exams for trying the practice engine. It only adds content, and running it again changes nothing.
// Run: npm run exams:sample. Listening uses a generated placeholder tone, because no real recording exists yet.
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { createPrismaClient } from "../src/config/database.js";
import { createExamAdminService } from "../src/services/exam/exam-admin.service.js";
import { LocalPrivateStorage } from "../src/services/storage/private-storage.js";

loadEnv({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });
const { DATABASE_URL: url, STORAGE_LOCAL_DIR: storageDir, NODE_ENV: nodeEnv } = process.env;
if (!url) throw new Error("Set DATABASE_URL.");
if (nodeEnv === "production") throw new Error("Sample exams are for development only.");
if (!storageDir) throw new Error("Set STORAGE_LOCAL_DIR, so the sample audio can be stored.");

function tone(seconds: number) {
  const rate = 8000;
  const samples = seconds * rate;
  const data = Buffer.alloc(44 + samples * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(36 + samples * 2, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const time = index / rate;
    data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 330 * time) * Math.sin(Math.PI * (time % 1)) ** 2 * 3000), 44 + index * 2);
  }
  return data;
}

const prisma = createPrismaClient(url);
const admin = createExamAdminService(prisma, new LocalPrivateStorage(storageDir));
const actor = { userId: "", roles: [], permissions: [] } as never;

async function author() {
  const row = await prisma.userRole.findFirst({ where: { role: { code: "SUPER_ADMIN" } }, select: { userId: true } });
  if (!row) throw new Error("Run npm run admin:create first.");
  return { ...(actor as object), userId: row.userId } as never;
}

async function exam(me: never, slug: string, title: string, options: { examType?: "ACADEMIC" | "GENERAL_TRAINING"; isMock?: boolean }, build: (versionId: string) => Promise<void>) {
  if (await prisma.exam.findUnique({ where: { slug } })) {
    console.log(`Skipped "${title}", which already exists.`);
    return;
  }
  const created = await admin.create(me, { title, slug, ...options });
  const versionId = created.versions[0]!.id;
  await build(versionId);
  await admin.updateVersion(me, versionId, { provenance: "ORIGINAL", sourceNote: "Original sample written for IELTiva development." });
  await admin.publish(me, versionId);
  console.log(`Published "${title}".`);
}

const PASSAGE = `In many crowded cities, the flat roofs of offices and apartment blocks have long been empty spaces, used for little more than water tanks and air-conditioning units. Over the past two decades, however, planners have begun to see them differently. A growing number of these roofs now hold soil, plants and sometimes small vegetable plots.

The attraction is partly practical. Plants absorb a large share of the sunlight that would otherwise heat a building, so the rooms below need less cooling in summer. Soil also holds rainwater for several hours, which reduces the pressure on city drains during heavy storms.

Installing a green roof is not simple. The structure must be strong enough to carry wet soil, and waterproofing has to be replaced if it fails, which can mean lifting the whole garden. For these reasons, the cost is usually higher than for a conventional roof, at least at first.

Supporters argue that the expense is recovered over time, since a protected roof surface tends to last longer. Critics reply that the savings depend heavily on local climate. In cooler regions, they point out, a building may benefit far less.`;

async function readingSection(versionId: string, durationSeconds: number) {
  const section = await admin.createSection(versionId, { skill: "READING", title: "Reading: Gardens above the city", durationSeconds, instructions: "Short original sample. A full IELTS Reading paper is longer." });
  await admin.createPassage(section.id, { title: "Gardens above the city", body: PASSAGE });
  const tfng = await admin.createGroup(section.id, { type: "TRUE_FALSE_NOT_GIVEN", instructions: "Do the statements agree with the information in the passage?" });
  await admin.createQuestion(tfng.id, { number: 1, prompt: "City roofs were once used mainly for gardens.", explanation: "The passage says they held little more than water tanks and air-conditioning units.", answers: [{ acceptedValue: "FALSE" }] });
  await admin.createQuestion(tfng.id, { number: 2, prompt: "Plants on a roof can reduce the need for cooling.", explanation: "Paragraph 2 says the rooms below need less cooling.", answers: [{ acceptedValue: "TRUE" }] });
  await admin.createQuestion(tfng.id, { number: 3, prompt: "Green roofs are most common in Asia.", explanation: "The passage doesn't mention regions of the world in this way.", answers: [{ acceptedValue: "NOT GIVEN" }] });
  const choice = await admin.createGroup(section.id, { type: "MULTIPLE_CHOICE_SINGLE", instructions: "Choose the correct letter." });
  await admin.createQuestion(choice.id, { number: 4, prompt: "What can make a repair to a green roof difficult?", options: [{ label: "A", body: "The garden may have to be lifted" }, { label: "B", body: "Plants grow back too quickly" }, { label: "C", body: "Rainwater damages the soil" }], answers: [{ acceptedValue: "A" }] });
  const heading = await admin.createGroup(section.id, { type: "MATCHING_HEADINGS", instructions: "Choose the best heading for each paragraph." });
  const headings = [{ label: "i", body: "Practical benefits for buildings" }, { label: "ii", body: "Why installation is challenging" }, { label: "iii", body: "A change in how roofs are seen" }];
  await admin.createQuestion(heading.id, { number: 5, prompt: "Paragraph 1", options: headings, answers: [{ acceptedValue: "iii" }] });
  await admin.createQuestion(heading.id, { number: 6, prompt: "Paragraph 3", options: headings, answers: [{ acceptedValue: "ii" }] });
  const completion = await admin.createGroup(section.id, { type: "SENTENCE_COMPLETION", instructions: "Complete the sentence. Use ONE WORD ONLY from the passage." });
  await admin.createQuestion(completion.id, { number: 7, prompt: "Critics say the savings depend on the local ____.", answers: [{ acceptedValue: "climate", maxWords: 1 }] });
}

async function listeningSection(versionId: string, durationSeconds: number) {
  const section = await admin.createSection(versionId, { skill: "LISTENING", title: "Listening: Booking a sports hall", durationSeconds, instructions: "The audio is a placeholder tone until real recordings are added, so these questions can't be answered from it yet." });
  const audio = await admin.uploadAudio(section.id, tone(20), 20);
  await admin.updateAudio(audio.id, { transcript: "Placeholder. A real recording and transcript will replace this sample." });
  const form = await admin.createGroup(section.id, { type: "FORM_COMPLETION", instructions: "Complete the form. Write ONE WORD AND/OR A NUMBER for each answer.", stimulus: { text: "Sports hall booking form" } });
  await admin.createQuestion(form.id, { number: 1, prompt: "Name of the centre:", answers: [{ acceptedValue: "Riverside", maxWords: 2 }] });
  await admin.createQuestion(form.id, { number: 2, prompt: "Number of people:", answers: [{ acceptedValue: "12" }, { acceptedValue: "twelve" }] });
  const choice = await admin.createGroup(section.id, { type: "MULTIPLE_CHOICE_SINGLE", instructions: "Choose the correct letter." });
  await admin.createQuestion(choice.id, { number: 3, prompt: "Which room does the caller choose?", options: [{ label: "A", body: "The main hall" }, { label: "B", body: "The small studio" }, { label: "C", body: "The outdoor court" }], answers: [{ acceptedValue: "B" }] });
  const map = await admin.createGroup(section.id, { type: "MAP_LABELLING", instructions: "Label the map. Choose the correct letter.", stimulus: { text: "The caller is told where to find the entrance." } });
  await admin.createQuestion(map.id, { number: 4, prompt: "Main entrance", options: [{ label: "A", body: "Beside the car park" }, { label: "B", body: "Opposite the cafe" }], answers: [{ acceptedValue: "A" }] });
}

async function writingSection(versionId: string, academic: boolean) {
  const section = await admin.createSection(versionId, { skill: "WRITING", title: "Writing", durationSeconds: 3600 });
  await admin.createWritingTask(section.id, academic
    ? { taskType: "ACADEMIC_TASK_1", prompt: "The fictional figures below show how people travelled to work in one city. In 2005, 58% went by car, 27% by bus, 6% by bicycle and 9% on foot. In 2025, 41% went by car, 31% by bus, 17% by bicycle and 11% on foot. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.", minWords: 150, suggestedMinutes: 20 }
    : { taskType: "GENERAL_TASK_1", prompt: "You recently stayed at a hotel and left something behind. Write a letter to the manager. Say when you stayed, describe what you lost, and explain how you would like it returned.", minWords: 150, suggestedMinutes: 20 });
  await admin.createWritingTask(section.id, { taskType: "TASK_2", prompt: "Some people believe that every city should make its centre free of private cars. To what extent do you agree or disagree? Give reasons for your answer and include relevant examples.", minWords: 250, suggestedMinutes: 40 });
}

async function speakingSection(versionId: string) {
  const section = await admin.createSection(versionId, { skill: "SPEAKING", title: "Speaking", durationSeconds: 840 });
  await admin.createSpeakingQuestion(section.id, { part: "PART_1", prompt: "What do you usually do at the weekend?", maxAnswerSeconds: 60 });
  await admin.createSpeakingQuestion(section.id, { part: "PART_1", prompt: "Do you prefer spending time indoors or outdoors? Why?", maxAnswerSeconds: 60 });
  await admin.createSpeakingQuestion(section.id, { part: "PART_2", prompt: "Describe a place you enjoy visiting.", cueCard: ["Where it is", "How often you go there", "What you do there", "And explain why you enjoy visiting it"], prepSeconds: 60, maxAnswerSeconds: 120 });
  await admin.createSpeakingQuestion(section.id, { part: "PART_3", prompt: "How might cities change their public spaces in the future?", maxAnswerSeconds: 90 });
}

try {
  const me = await author();
  await exam(me, "sample-reading-academic", "Sample Reading: Gardens above the city", { examType: "ACADEMIC" }, (id) => readingSection(id, 1200));
  await exam(me, "sample-listening", "Sample Listening: Booking a sports hall", {}, (id) => listeningSection(id, 600));
  await exam(me, "sample-writing-academic", "Sample Writing: Academic", { examType: "ACADEMIC" }, (id) => writingSection(id, true));
  await exam(me, "sample-writing-general", "Sample Writing: General Training", { examType: "GENERAL_TRAINING" }, (id) => writingSection(id, false));
  await exam(me, "sample-speaking", "Sample Speaking", {}, speakingSection);
  await exam(me, "sample-mock-academic", "Short sample mock test: Academic", { examType: "ACADEMIC", isMock: true }, async (id) => {
    await listeningSection(id, 600);
    await readingSection(id, 1200);
    await writingSection(id, true);
  });
  console.log("Sample exams are ready.");
} finally {
  await prisma.$disconnect();
}
