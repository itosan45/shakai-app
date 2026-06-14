import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const engineSource = html.match(/<script id="learning-engine">([\s\S]*?)<\/script>/)?.[1] || "";
const appScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].at(-1)[1];
const dataSource = appScript.slice(appScript.indexOf("const SUBJECTS="), appScript.indexOf("const STORE="));

const engineContext = {};
vm.createContext(engineContext);
vm.runInContext(
  `${engineSource};globalThis.scopeApi={defaultLearnedTopicIds,isQuestionAvailable,filterAvailableQuestions,skipUnlearnedTopic}`,
  engineContext
);
const scopeApi = engineContext.scopeApi;

const dataContext = {};
vm.createContext(dataContext);
vm.runInContext(
  `${dataSource};globalThis.catalog={topics:TOPICS,units:UNITS,questions:QUESTIONS}`,
  dataContext
);
const catalog = JSON.parse(JSON.stringify(dataContext.catalog));

test("all generated questions have complete curriculum metadata", () => {
  assert.equal(catalog.questions.length, 152);
  assert.ok(catalog.questions.every(q =>
    Number.isInteger(q.grade)
    && q.topicId
    && q.topicName
    && Array.isArray(q.prerequisites)
    && ["基礎", "標準", "入試"].includes(q.difficulty)
  ));
});

test("geography and history are learned by default while civics stays selectable", () => {
  const learned = scopeApi.defaultLearnedTopicIds(catalog.topics);
  const grade12 = catalog.topics.filter(topic => topic.grade < 3).map(topic => topic.id);
  assert.deepEqual(JSON.parse(JSON.stringify(learned)), grade12);
  assert.ok(catalog.topics.filter(topic => ["geography", "history"].includes(topic.subjectId)).every(topic => learned.includes(topic.id)));
  for (const id of ["civics-constitution", "civics-politics", "civics-local-government", "civics-economy"]) {
    assert.equal(learned.includes(id), false);
  }
});

test("unlearned civics and civics-dependent source questions are filtered", () => {
  const learned = scopeApi.defaultLearnedTopicIds(catalog.topics);
  const constitution = catalog.questions.find(q => q.topicId === "civics-constitution");
  const dependentSource = catalog.questions.find(q => q.subjectId === "sources" && q.prerequisites.includes("civics-economy"));
  assert.ok(constitution);
  assert.ok(dependentSource);
  assert.equal(scopeApi.isQuestionAvailable(constitution, learned), false);
  assert.equal(scopeApi.isQuestionAvailable(dependentSource, learned), false);
  assert.equal(scopeApi.filterAvailableQuestions([constitution, dependentSource], learned).length, 0);
  assert.equal(scopeApi.isQuestionAvailable(dependentSource, [...learned, "civics-economy"]), true);
});

test("marking a topic unlearned removes its deck without changing achievement data", () => {
  const state = {
    learnedTopics: ["geography-japan", "civics-politics"],
    attempts: 12,
    correct: 8,
    weak: { q1: 2 },
    history: [{ id: "q1", ok: false }]
  };
  const result = scopeApi.skipUnlearnedTopic(state, "civics-politics", [
    { id: "a", topicId: "civics-politics" },
    { id: "b", topicId: "geography-japan" },
    { id: "c", topicId: "civics-politics" }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.learnedTopics)), ["geography-japan"]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.deck.map(q => q.id))), ["b"]);
  assert.equal(result.attempts, 12);
  assert.equal(result.correct, 8);
  assert.deepEqual(JSON.parse(JSON.stringify(result.weak)), { q1: 2 });
  assert.deepEqual(JSON.parse(JSON.stringify(result.history)), [{ id: "q1", ok: false }]);
});

test("scope UI, zero-question guidance, and Android handlers are present", () => {
  assert.match(html, /id="screen-scope"/);
  assert.match(html, /学習範囲を変更/);
  assert.match(html, /まだ習っていない/);
  assert.match(html, /出題できる問題がありません/);
  for (const handler of ["showScope", "toggleTopic", "saveScope", "markCurrentTopicUnlearned"]) {
    assert.match(html, new RegExp(`window\\.${handler}\\s*=\\s*${handler}`));
  }
});

test("marking a topic unlearned does not ask for confirmation", () => {
  assert.doesNotMatch(html,/\bconfirm\s*\(/);
});
