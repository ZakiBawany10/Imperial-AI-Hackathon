// Builds ascend-pitch.pptx: 16 full-bleed 1920x1080 slide images, with the matching section of
// ../pitch_script.md as each slide's speaker notes. Run: node build.js (needs pptxgenjs).
const fs = require("fs"), path = require("path");
const pptxgen = require(process.env.PPTXGENJS || "pptxgenjs");
const order = [
  "screens/orig-01-intro.png", "extra-01.png", "screens/orig-02-how-it-works.png",
  "extra-02.png", "extra-03.png", "extra-04.png", "screens/orig-03-voice-coach.png",
  "extra-05.png", "screens/orig-04-the-loop.png", "extra-06.png", "extra-07.png",
  "extra-08.png", "extra-09.png", "screens/orig-05-design-before-after.png", "extra-10.png",
  "screens/orig-06-end.png",
];
const titles = ["Ascend", "Every new wall is a guess", "How it works", "A grade for your body",
  "Under the hood", "Safest, not shortest", "Voice coach", "Accessibility", "It gets better with every climb",
  "Record and share", "Results", "What we ran into", "What we learned", "Design: before and after",
  "What's next", "Ascend: ascend-climb.vercel.app"];
// speaker notes = the "## N." sections of the script; the demo-video section joins slide 2
const md = fs.readFileSync(path.join(__dirname, "../pitch_script.md"), "utf8");
const parts = md.split(/^## /m).slice(1);
const notes = {};
for (const p of parts) {
  const m = p.match(/^(\d+)\./);
  const clean = p.replace(/\*\*|\*|`/g, "").replace(/^---\s*$/gm, "").trim();
  // unwrap the markdown's hard line breaks, keeping list items and paragraphs
  const text = clean.replace(/\n(?!\n|- |\d+\. )\s*/g, " ");
  if (m) notes[+m[1]] = text;
  else if (/^Demo video/.test(p)) notes[2] += "\n\nTHEN PLAY THE DEMO VIDEO\n" + text;
  else if (/^Likely questions/.test(p)) notes[16] += "\n\n" + text;
}
const pres = new pptxgen();
pres.layout = "LAYOUT_16x9";
pres.title = "Ascend";
pres.author = "Krishna, Adam, Zaki";
order.forEach((img, i) => {
  const s = pres.addSlide();
  s.background = { color: "FFFFFF" };
  s.addImage({ path: path.join(__dirname, img), x: 0, y: 0, w: 10, h: 5.625, altText: titles[i] });
  s.addNotes(notes[i + 1] || "");
});
pres.writeFile({ fileName: path.join(__dirname, "ascend-pitch.pptx") }).then((f) => {
  require("child_process").execSync(`zip -dq "${f}" "*/" || true`);
  console.log("wrote", f);
});
